import * as React from 'react'
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view'
import Ionicon from 'react-native-vector-icons/Ionicons'
import { sprintf } from 'sprintf-js'

import { AAVE_SUPPORT_ARTICLE_URL_1S } from '../../../constants/aaveConstants'
import { SCROLL_INDICATOR_INSET_FIX } from '../../../constants/constantSettings'
import { makeActionProgram } from '../../../controllers/action-queue/ActionProgram'
import { dryrunActionProgram } from '../../../controllers/action-queue/runtime/dryrunActionProgram'
import { makeInitialProgramState } from '../../../controllers/action-queue/util/makeInitialProgramState'
import {
  runLoanActionProgram,
  saveLoanAccount
} from '../../../controllers/loan-manager/redux/actions'
import { LoanAccount } from '../../../controllers/loan-manager/types'
import { useAsyncValue } from '../../../hooks/useAsyncValue'
import { useExecutionContext } from '../../../hooks/useExecutionContext'
import { useHandler } from '../../../hooks/useHandler'
import { useUrlHandler } from '../../../hooks/useUrlHandler'
import { useWatch } from '../../../hooks/useWatch'
import { lstrings } from '../../../locales/strings'
import { useDispatch, useSelector } from '../../../types/reactRedux'
import { EdgeAppSceneProps } from '../../../types/routerTypes'
import { makeAaveCloseAction } from '../../../util/ActionProgramUtils'
import { getExecutionNetworkFees } from '../../../util/networkFeeUtils'
import { filterNull } from '../../../util/safeFilters'
import { translateError } from '../../../util/translateError'
import { zeroString } from '../../../util/utils'
import { EdgeTouchableOpacity } from '../../common/EdgeTouchableOpacity'
import { SceneWrapper } from '../../common/SceneWrapper'
import { withLoanAccount } from '../../hoc/withLoanAccount'
import { Space } from '../../layout/Space'
import { CryptoFiatAmountRow } from '../../rows/CryptoFiatAmountRow'
import { EdgeRow } from '../../rows/EdgeRow'
import { cacheStyles, Theme, useTheme } from '../../services/ThemeContext'
import { Alert } from '../../themed/Alert'
import { SafeSlider } from '../../themed/SafeSlider'
import { SceneHeader } from '../../themed/SceneHeader'
import { NetworkFeeTile } from '../../tiles/NetworkFeeTile'
import { TotalDebtCollateralTile } from '../../tiles/TotalDebtCollateralTile'

export interface LoanCloseParams {
  loanAccountId: string
}

export interface Props extends EdgeAppSceneProps<'loanClose'> {
  loanAccount: LoanAccount
}

// TODO: Check contentPadding

export const LoanCloseSceneComponent = (props: Props) => {
  const theme = useTheme()
  const styles = getStyles(theme)
  const dispatch = useDispatch()

  const clientId = useSelector(state => state.core.context.clientId)

  const executionContext = useExecutionContext()

  const { navigation, loanAccount } = props
  const { borrowPlugin, borrowEngine } = loanAccount
  const borrowPluginId = borrowPlugin.borrowInfo.borrowPluginId
  const { currencyWallet: borrowEngineWallet } = borrowEngine

  const borrowEngineCollaterals = useWatch(borrowEngine, 'collaterals')
  const collaterals = React.useMemo(
    () =>
      borrowEngineCollaterals.filter(
        collateral => !zeroString(collateral.nativeAmount)
      ),
    [borrowEngineCollaterals]
  )
  const collateral = collaterals[0]
  const collateralTokenId = collateral?.tokenId

  const borrowEngineDebts = useWatch(borrowEngine, 'debts')
  const debts = React.useMemo(
    () => borrowEngineDebts.filter(debt => !zeroString(debt.nativeAmount)),
    [borrowEngineDebts]
  )
  const debt = debts[0]
  const debtTokenId = debt?.tokenId

  // Derived State:

  // Create Action Ops
  const exchangeRates = useSelector(state => state.exchangeRates)
  const defaultIsoFiat = useSelector(state => state.ui.settings.defaultIsoFiat)
  const [actionProgram, actionProgramError] = useAsyncValue(async () => {
    const actionOp = await makeAaveCloseAction({
      borrowPluginId,
      borrowEngine,
      defaultIsoFiat,
      exchangeRates
    })

    if (actionOp == null) return null

    const actionProgram = await makeActionProgram(actionOp)

    return actionProgram
  }, [
    borrowEngine,
    borrowEngineWallet,
    borrowPluginId,
    collateral,
    collateralTokenId,
    debt,
    debtTokenId
  ])

  const [networkFeeMap, networkFeeMapError] = useAsyncValue(async () => {
    if (actionProgram === undefined) return
    if (actionProgram === null) return null
    const executionOutputs = await dryrunActionProgram(
      executionContext,
      actionProgram,
      makeInitialProgramState(clientId, actionProgram.programId),
      false
    )
    const networkFeeMap = getExecutionNetworkFees(executionOutputs)
    return networkFeeMap
  }, [actionProgram])

  const aggregateErrorMessage = filterNull(
    [actionProgramError, networkFeeMapError].map(err =>
      err != null ? translateError(err.message) : null
    )
  )

  const isActionProgramLoading =
    actionProgram === undefined || networkFeeMap === undefined

  // TODO: Pass networkFeeMap to a component which can display fee total for NetworkFeeMap interfaces
  const networkFeeAggregate = (networkFeeMap ?? {})[
    borrowEngineWallet.currencyInfo.currencyCode
  ]
  const networkFeeAmountAggregate =
    networkFeeAggregate != null ? networkFeeAggregate.nativeAmount : '0'

  //
  // Handlers
  //

  const handleInfoIconPress = useUrlHandler(
    sprintf(AAVE_SUPPORT_ARTICLE_URL_1S, 'close-loan')
  )

  const handleSliderComplete = useHandler(async (reset: () => void) => {
    // Still loading action program
    if (actionProgram === undefined) return

    // Dispatch action program if necessary to close loan
    if (actionProgram !== null) {
      await dispatch(
        runLoanActionProgram(loanAccount, actionProgram, 'loan-close')
      )
      // Navigate to the loan details scene if program is dispatched
      navigation.navigate('loanDetails', { loanAccountId: loanAccount.id })
    } else {
      // Update the loan program marking it as close
      await dispatch(saveLoanAccount({ ...loanAccount, closed: true }))
      // Navigate to loan dashboard scene if no action program is necessary
      navigation.navigate('loanDashboard')
    }
  })

  return (
    <SceneWrapper>
      <SceneHeader
        tertiary={
          <EdgeTouchableOpacity onPress={handleInfoIconPress}>
            <Ionicon
              name="information-circle-outline"
              size={theme.rem(1.25)}
              color={theme.iconTappable}
            />
          </EdgeTouchableOpacity>
        }
        title={lstrings.loan_close_loan_title}
        underline
        withTopMargin
      />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.container}
        extraScrollHeight={theme.rem(2.75)}
        enableOnAndroid
        scrollIndicatorInsets={SCROLL_INDICATOR_INSET_FIX}
      >
        <TotalDebtCollateralTile
          title={lstrings.loan_remaining_principal}
          wallet={borrowEngineWallet}
          debtsOrCollaterals={debts}
        />
        <NetworkFeeTile
          wallet={borrowEngineWallet}
          nativeAmount={networkFeeAmountAggregate}
        />
        {debts.length > 0 ? (
          <EdgeRow title={lstrings.loan_remaining_principal}>
            {debts.map(debt => (
              <CryptoFiatAmountRow
                nativeAmount={debt.nativeAmount}
                tokenId={debt.tokenId}
                wallet={borrowEngineWallet}
                key={debt.tokenId}
              />
            ))}
          </EdgeRow>
        ) : null}
        {collaterals.length > 0 ? (
          <EdgeRow title={lstrings.loan_collateral_amount}>
            {collaterals.map(collateral => (
              <CryptoFiatAmountRow
                nativeAmount={collateral.nativeAmount}
                tokenId={collateral.tokenId}
                wallet={borrowEngineWallet}
                key={collateral.tokenId}
              />
            ))}
          </EdgeRow>
        ) : null}
        {aggregateErrorMessage.length > 0 ? (
          <Alert
            title={lstrings.fragment_error}
            message={translateError(aggregateErrorMessage.join('\n\n'))}
            type="error"
            numberOfLines={7}
            marginRem={[1, 1, 0]}
          />
        ) : actionProgram !== null ? (
          <Alert
            title={lstrings.loan_close_loan_title}
            message={lstrings.loan_close_swap_warning}
            type="warning"
            numberOfLines={10}
            marginRem={[1, 1, 0]}
          />
        ) : (
          <Alert
            title={lstrings.loan_close_loan_title}
            message={lstrings.loan_close_loan_no_tx_needed_message}
            type="warning"
            numberOfLines={7}
            marginRem={[1, 1, 0]}
          />
        )}

        <Space topRem={1} bottomRem={2}>
          <SafeSlider
            onSlidingComplete={handleSliderComplete}
            disabled={isActionProgramLoading}
            disabledText={lstrings.send_confirmation_slide_to_confirm}
          />
        </Space>
      </KeyboardAwareScrollView>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    paddingTop: theme.rem(0.5)
  }
}))

export const LoanCloseScene = withLoanAccount(LoanCloseSceneComponent)
