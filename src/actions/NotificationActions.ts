import messaging from '@react-native-firebase/messaging'
import { asMaybe } from 'cleaners'
import { EdgeContext, EdgeCurrencyInfo } from 'edge-core-js'
import { getUniqueId } from 'react-native-device-info'
import { base64 } from 'rfc4648'
import { sprintf } from 'sprintf-js'

import { SPECIAL_CURRENCY_INFO } from '../constants/WalletAndCurrencyConstants'
import {
  asDevicePayload,
  DevicePayload,
  DeviceUpdatePayload,
  NewPushEvent
} from '../controllers/action-queue/types/pushApiTypes'
import { asPriceChangeTrigger } from '../controllers/action-queue/types/pushCleaners'
import { PriceChangeTrigger } from '../controllers/action-queue/types/pushTypes'
import { ENV } from '../env'
import { lstrings } from '../locales/strings'
import { getActiveWalletCurrencyInfos } from '../selectors/WalletSelectors'
import { ThunkAction } from '../types/reduxTypes'
import { base58 } from '../util/encoding'
import { fetchPush } from '../util/network'
import { getDenomFromIsoCode, removeIsoPrefix } from '../util/utils'

export interface NotificationSettings {
  ignoreMarketing: boolean
  ignorePriceChanges: boolean
  plugins: {
    [pluginId: string]: {
      eventId: string
      currencyPair: string
      dailyChange?: number
      hourlyChange?: number
    }
  }
}

export function registerNotificationsV2(
  changeFiat: boolean = false
): ThunkAction<Promise<void>> {
  return async (dispatch, getState) => {
    const state = getState()
    const { defaultIsoFiat } = state.ui.settings
    let serverSettings: DevicePayload = {
      loginIds: [],
      events: [],
      ignoreMarketing: false,
      ignorePriceChanges: false
    }
    try {
      const deviceToken = await messaging()
        .getToken()
        .catch(() => '')

      const body = {
        apiKey: ENV.EDGE_API_KEY,
        deviceId: state.core.context.clientId,
        deviceToken,
        loginId: base64.stringify(base58.parse(state.core.account.rootLoginId))
      }
      const opts = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
      const response = await fetchPush('v2/device/', opts)

      serverSettings = asDevicePayload(await response.text())

      const currencyWallets = state.core.account.currencyWallets
      const activeCurrencyInfos = getActiveWalletCurrencyInfos(currencyWallets)

      const createEvents: NewPushEvent[] = []
      const removeEvents: string[] = []

      if (serverSettings.events.length !== 0) {
        // v2 settings exist already, see if we need to add new ones
        for (const currencyInfo of activeCurrencyInfos) {
          if (
            // Must not be deprecated
            !SPECIAL_CURRENCY_INFO[currencyInfo.pluginId].keysOnlyMode &&
            // Must not already be present with current fiat setting
            !serverSettings.events.some(
              event =>
                event.trigger.type === 'price-change' &&
                event.trigger.pluginId === currencyInfo.pluginId &&
                (!changeFiat ||
                  event.trigger.currencyPair.includes(defaultIsoFiat))
            )
          ) {
            // Add new push event
            createEvents.push(
              newPriceChangeEvent(currencyInfo, defaultIsoFiat, true, true)
            )
          }
        }

        // See if we need to remove any deprecated currencies (keys-only)
        for (const event of serverSettings.events) {
          const { trigger } = event
          if (trigger.type === 'price-change') {
            const currencyInfo = activeCurrencyInfos.find(
              currencyInfo => currencyInfo.pluginId === trigger.pluginId
            )
            if (
              currencyInfo != null &&
              SPECIAL_CURRENCY_INFO[currencyInfo.pluginId].keysOnlyMode
            ) {
              removeEvents.push(event.eventId)
            }
          }
        }
      } else {
        // No v2 settings exist so let's check v1
        const userId = state.core.account.rootLoginId
        const encodedUserId = encodeURIComponent(userId)

        let v1Settings = {
          notifications: {
            currencyCodes: {}
          }
        }

        try {
          v1Settings = await legacyGet(`/user?userId=${encodedUserId}`)
        } catch (e: any) {
          // Failure is ok we'll just create new settings
        }

        if (Object.keys(v1Settings.notifications.currencyCodes).length === 0) {
          // v1 settings don't exist either so let's create them
          for (const currencyInfo of activeCurrencyInfos) {
            createEvents.push(
              newPriceChangeEvent(currencyInfo, defaultIsoFiat, true, true)
            )
          }
        } else {
          // v1 settings do exist let's migrate them to v2
          const currencySettings: Array<{
            '1': boolean
            '24': boolean
            fallbackSettings?: boolean
          }> = await Promise.all(
            activeCurrencyInfos.map(
              async info => await fetchLegacySettings(userId, info.currencyCode)
            )
          )

          for (const [i, setting] of currencySettings.entries()) {
            if (setting.fallbackSettings) {
              // Settings didn't exist for that currency code so we'll create them using default options
              createEvents.push(
                newPriceChangeEvent(
                  activeCurrencyInfos[i],
                  defaultIsoFiat,
                  true,
                  true
                )
              )
            } else {
              // Settings did exist for that currency code so we'll use them
              createEvents.push(
                newPriceChangeEvent(
                  activeCurrencyInfos[i],
                  defaultIsoFiat,
                  setting[1],
                  setting[24]
                )
              )
            }
          }
        }
      }

      if (createEvents.length > 0 || removeEvents.length > 0) {
        serverSettings = await updateServerSettings(state.core.context, {
          createEvents,
          removeEvents
        })
      }
    } catch (e: any) {
      // If this fails we don't need to bother the user just log and move on.
      console.log('registerNotificationsV2 error:', e.message)
    }

    dispatch({
      type: 'NOTIFICATION_SETTINGS_UPDATE',
      data: serverSettingsToNotificationSettings(serverSettings)
    })
  }
}

export function updateNotificationSettings(
  data: DeviceUpdatePayload
): ThunkAction<Promise<void>> {
  return async (dispatch, getState) => {
    const state = getState()
    dispatch({
      type: 'NOTIFICATION_SETTINGS_UPDATE',
      data: serverSettingsToNotificationSettings(
        await updateServerSettings(state.core.context, data)
      )
    })
  }
}

const serverSettingsToNotificationSettings = (
  serverSettings: DevicePayload
): NotificationSettings => {
  const data: NotificationSettings = {
    ignoreMarketing: serverSettings.ignoreMarketing,
    ignorePriceChanges: serverSettings.ignorePriceChanges,
    plugins: {}
  }

  for (const event of serverSettings.events) {
    if (event.state !== 'waiting') continue
    const trigger = asMaybe(asPriceChangeTrigger)(event.trigger)
    if (trigger == null) continue

    data.plugins[trigger.pluginId] = {
      eventId: event.eventId,
      currencyPair: trigger.currencyPair,
      dailyChange: trigger.dailyChange,
      hourlyChange: trigger.hourlyChange
    }
  }

  return data
}

async function updateServerSettings(
  context: EdgeContext,
  data: DeviceUpdatePayload
): Promise<DevicePayload> {
  const deviceId = context.clientId
  const loginIds = context.localUsers.map(row =>
    base64.stringify(base58.parse(row.loginId))
  )
  const deviceToken = await messaging()
    .getToken()
    .catch(() => '')

  const body = {
    apiKey: ENV.EDGE_API_KEY,
    deviceId,
    deviceToken,
    data: { ...data, loginIds }
  }
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }

  const response = await fetchPush('v2/device/update/', opts)

  return asDevicePayload(await response.text())
}

export const newPriceChangeEvent = (
  currencyInfo: EdgeCurrencyInfo,
  isoFiatCurrencyCode: string,
  hourlyChangeEnabled: boolean,
  dailyChangeEnabled: boolean
): NewPushEvent => {
  const { currencyCode, displayName, pluginId } = currencyInfo

  const fiatDenomination = getDenomFromIsoCode(
    removeIsoPrefix(isoFiatCurrencyCode)
  )
  const fiatSymbol = fiatDenomination.symbol ?? ''

  const fiatSymbolString = `${fiatSymbol}#to_price#`
  const changeUpString = '+#change#%'
  const changeDownString = '#change#%'

  const pushMessage = {
    title: lstrings.price_alert,
    body: '#direction#',
    data: {
      type: 'price-change',
      pluginId
    }
  }

  const trigger: PriceChangeTrigger = {
    type: 'price-change',
    currencyPair: `${currencyInfo.currencyCode}_${isoFiatCurrencyCode}`,

    directions: [
      // [hourUp, hourDown, dayUp, dayDown]
      `${sprintf(
        lstrings.notification_hourly_price_change_up,
        String.fromCodePoint(0x1f4c8),
        displayName,
        currencyCode,
        changeUpString,
        fiatSymbolString
      )}`,
      `${sprintf(
        lstrings.notification_hourly_price_change_down,
        String.fromCodePoint(0x1f4c9),
        displayName,
        currencyCode,
        changeDownString,
        fiatSymbolString
      )}`,
      `${sprintf(
        lstrings.notification_daily_price_change_up,
        String.fromCodePoint(0x1f4c8),
        displayName,
        currencyCode,
        changeUpString,
        fiatSymbolString
      )}`,
      `${sprintf(
        lstrings.notification_daily_price_change_down,
        String.fromCodePoint(0x1f4c9),
        displayName,
        currencyCode,
        changeDownString,
        fiatSymbolString
      )}`
    ],
    pluginId: currencyInfo.pluginId,
    dailyChange: dailyChangeEnabled ? 10 : undefined,
    hourlyChange: hourlyChangeEnabled ? 3 : undefined
  }

  const event = {
    eventId: currencyInfo.currencyCode,
    pushMessage,
    trigger
  }

  return event
}

export const fetchLegacySettings = async (
  userId: string,
  currencyCode: string
) => {
  const deviceId = await getUniqueId()
  const deviceIdEncoded = encodeURIComponent(deviceId)
  const encodedUserId = encodeURIComponent(userId)
  return await legacyGet(
    `user/notifications/${currencyCode}?userId=${encodedUserId}&deviceId=${deviceIdEncoded}`
  )
}

async function legacyGet(path: string) {
  const response = await fetchPush(`v1/${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': ENV.EDGE_API_KEY
    }
  })
  if (response != null && response.ok) {
    return await response.json()
  } else {
    throw new Error('Error accessing notification server')
  }
}
