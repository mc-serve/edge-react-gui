import { asDate, asJSON, asObject, uncleaner } from 'cleaners'
import { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { Platform } from 'react-native'
import {
  BatteryOptEnabled,
  RequestDisableOptimization
} from 'react-native-battery-optimization-check'
import { usePowerState } from 'react-native-device-info'

import { updateExchangeInfo } from '../../actions/ExchangeInfoActions'
import { refreshConnectedWallets } from '../../actions/FioActions'
import { refreshAllFioAddresses } from '../../actions/FioAddressActions'
import { registerNotificationsV2 } from '../../actions/NotificationActions'
import { trackAppUsageAfterUpgrade } from '../../actions/RequestReviewActions'
import { checkCompromisedKeys } from '../../actions/WalletActions'
import { ENV } from '../../env'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { useRefresher } from '../../hooks/useRefresher'
import { lstrings } from '../../locales/strings'
import { defaultAccount } from '../../reducers/CoreReducer'
import { FooterAccordionEventService } from '../../state/SceneFooterState'
import { useDispatch, useSelector } from '../../types/reactRedux'
import { NavigationBase } from '../../types/routerTypes'
import {
  height,
  ratioHorizontal,
  ratioVertical,
  width
} from '../../util/scaling'
import { snooze } from '../../util/utils'
import { FioCreateHandleModal } from '../modals/FioCreateHandleModal'
import { AlertDropdown } from '../navigation/AlertDropdown'
import { AccountCallbackManager } from './AccountCallbackManager'
import { ActionQueueService } from './ActionQueueService'
import { Airship, showDevError } from './AirshipInstance'
import { AutoLogout } from './AutoLogout'
import { ContactsLoader } from './ContactsLoader'
import { EdgeContextCallbackManager } from './EdgeContextCallbackManager'
import { FioService } from './FioService'
import { LoanManagerService } from './LoanManagerService'
import { NetworkActivity } from './NetworkActivity'
import { NotificationService } from './NotificationService'
import { PasswordReminderService } from './PasswordReminderService'
import { PermissionsManager } from './PermissionsManager'
import { SortedWalletList } from './SortedWalletList'
import { WalletConnectService } from './WalletConnectService'
import { WalletLifecycle } from './WalletLifecycle'
import { WipeLogsService } from './WipeLogsService'

interface Props {
  navigation: NavigationBase
}

const REFRESH_INFO_SERVER_MS = 10 * 60 * 1000 // 10 minutes

const FIO_CREATE_HANDLE_ITEM_ID = 'fioCreateHandleRecord'
const asFioCreateHandleRecord = asJSON(
  asObject({
    ignored: asDate
  })
)

let isFioModalShown = false

/**
 * Provides various services to the application. These are non-visual components
 * which provide some background tasks and exterior functionality for the app.
 */
export function Services(props: Props) {
  const dispatch = useDispatch()
  const account = useSelector(state =>
    state.core.account !== defaultAccount ? state.core.account : undefined
  )
  const powerState = usePowerState()
  const { navigation } = props

  // Show FIO handle modal for new accounts or existing accounts without a FIO wallet:
  const maybeShowFioHandleModal = useHandler(async (account: EdgeAccount) => {
    // HACK: Latest React Navigation causes multiple mounts
    if (isFioModalShown) return
    isFioModalShown = true

    // Duress accounts don't need to create a FIO handle:
    if (account.isDuressAccount) {
      return
    }

    const { freeRegApiToken = undefined, freeRegRefCode = undefined } =
      typeof ENV.FIO_INIT === 'object' ? ENV.FIO_INIT : {}
    const hasFioWallets = account.allKeys.some(
      keyInfo => keyInfo.type === 'wallet:fio'
    )

    if (
      freeRegApiToken != null &&
      freeRegRefCode != null &&
      !account.newAccount &&
      account.username != null &&
      !hasFioWallets
    ) {
      const fioCreateHandleRecord = await account.dataStore
        .getItem('', FIO_CREATE_HANDLE_ITEM_ID)
        .then(asFioCreateHandleRecord)
        .catch(() => undefined)

      if (fioCreateHandleRecord == null) {
        const shouldCreateHandle = await Airship.show<boolean>(bridge => (
          <FioCreateHandleModal bridge={bridge} />
        ))
        if (shouldCreateHandle) {
          navigation.navigate('fioCreateHandle', {
            freeRegApiToken,
            freeRegRefCode
          })
        } else {
          await account.dataStore.setItem(
            '',
            FIO_CREATE_HANDLE_ITEM_ID,
            uncleaner(asFioCreateHandleRecord)({ ignored: new Date() })
          )
        }
      }
    }
  })

  React.useEffect(() => {
    console.log(`Dimensions: get(window) width=${width} height=${height}`)
    console.log(
      `Dimensions: ratioHorizontal=${ratioHorizontal} ratioVertical=${ratioVertical}`
    )
  }, [])

  // Methods to call immediately after login:
  useAsyncEffect(
    async () => {
      if (account != null) {
        await maybeShowFioHandleModal(account)
      }
    },
    [account, maybeShowFioHandleModal],
    'Services 1'
  )

  React.useEffect(() => {
    if (account != null) {
      dispatch(trackAppUsageAfterUpgrade()).catch(err => console.warn(err))
    }
  }, [account, dispatch])

  // Methods to call once all of the currency wallets have been loaded
  useAsyncEffect(
    async () => {
      if (account?.waitForAllWallets == null) return
      await account.waitForAllWallets()

      dispatch(registerNotificationsV2()).catch(e => {
        console.warn('registerNotificationsV2 error:', e)
      })

      await dispatch(refreshConnectedWallets).catch(err => console.warn(err))
      await dispatch(refreshAllFioAddresses()).catch(err => console.warn(err))

      // HACK: The balances object isn't full when the above promise resolves so we need to wait a few seconds before proceeding
      await snooze(5000)
      dispatch(checkCompromisedKeys(navigation)).catch(e => {
        console.warn('checkCompromisedKeys error:', e)
      })
    },
    [account],
    'Services 2'
  )

  useAsyncEffect(
    async () => {
      if (Platform.OS !== 'android' || !powerState.lowPowerMode) {
        return
      }

      const batteryOptEnabled = await BatteryOptEnabled()
      if (!batteryOptEnabled) {
        return
      }
      console.warn(
        'Battery saver mode enabled and battery optimization is disabled'
      )
      await Airship.show(bridge => {
        const onPress = async () => {
          await RequestDisableOptimization()
          bridge.resolve()
        }
        return (
          <AlertDropdown
            bridge={bridge}
            onPress={onPress}
            message={lstrings.warning_battery_saver}
            warning
            persistent
          />
        )
      }).catch(e => showDevError(e))
    },
    [powerState],
    'Services 3'
  )

  // Methods to call periodically
  useRefresher(
    async () => {
      dispatch(updateExchangeInfo()).catch(err => console.warn(err))
    },
    undefined,
    REFRESH_INFO_SERVER_MS
  )

  const startLoanManager = ENV.BETA_FEATURES && account != null

  return (
    <>
      {ENV.BETA_FEATURES ? <ActionQueueService /> : null}
      {account == null ? null : <NotificationService account={account} />}
      <AutoLogout />
      <ContactsLoader />
      {account == null ? null : (
        <AccountCallbackManager account={account} navigation={navigation} />
      )}
      {account == null ? null : <SortedWalletList account={account} />}
      <EdgeContextCallbackManager navigation={navigation} />
      {account == null ? null : (
        <FioService account={account} navigation={navigation} />
      )}
      <PermissionsManager />
      {startLoanManager ? <LoanManagerService account={account} /> : null}
      <NetworkActivity />
      <PasswordReminderService />
      {account == null ? null : <WalletConnectService account={account} />}
      <WalletLifecycle />
      <WipeLogsService />
      <FooterAccordionEventService />
    </>
  )
}
