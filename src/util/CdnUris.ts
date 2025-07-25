import { EdgeTokenId } from 'edge-core-js'

import { EDGE_CONTENT_SERVER_URI } from '../constants/CdnConstants'
import { BorrowPluginInfo } from '../plugins/borrow-plugins/types'
import { edgeDark } from '../theme/variables/edgeDark'
import { edgeLight } from '../theme/variables/edgeLight'
import { Theme } from '../types/Theme'
import { removeHexPrefix } from './utils'

/**
 * New user FIO handle signup flow
 */
export const getFioCustomizeHandleImage = (theme: Theme) => {
  return getThemedIconUri(theme, 'FIO/fioCustomizeHandle')
}

/**
 * Borrow Plugin Icons
 */
export const getBorrowPluginIconUri = (borrowPluginInfo: BorrowPluginInfo) => {
  return getCurrencyIconUris(
    borrowPluginInfo.currencyPluginId,
    borrowPluginInfo.displayTokenId
  ).symbolImage
}

/**
 * Swap Plugin Icons
 */
export function getSwapPluginIconUri(pluginId: string, theme: Theme) {
  return `${theme.iconServerBaseUri}/exchangeIcons/${pluginId}/icon.png`
}

/**
 * Stake Provider Icons
 * Icons to differentiate multiple staking options that share the same assets.
 */
export function getStakeProviderIcon(
  pluginId: string,
  providerId: string,
  theme: Theme
) {
  return `${theme.iconServerBaseUri}/stakeProviderIcons/${pluginId}/${providerId}/icon.png`
}

/**
 * Currency Icons
 */
export interface CurrencyIcons {
  symbolImage: string
  symbolImageDarkMono: string
}

export function getCurrencyIconUris(
  pluginId: string,
  tokenId: EdgeTokenId,
  showChainIcon: boolean = false
): CurrencyIcons {
  const iconFile =
    showChainIcon && tokenId === null
      ? `chain_${pluginId}`
      : tokenId ?? pluginId
  const currencyPath = `${pluginId}/${removeHexPrefix(iconFile)}`.toLowerCase()
  return {
    symbolImage: `${edgeLight.iconServerBaseUri}/currencyIconsV3/${currencyPath}.png`,
    symbolImageDarkMono: `${edgeDark.iconServerBaseUri}/currencyIconsV3/${currencyPath}_dark.png`
  }
}

/**
 * Partner Icons
 */

// TODO: Add other CDN references to the theme files to allow third-party config:
// flags, contacts, partners, etc.
// Clean up file naming scheme to be more generic, if possible.

export function getPartnerIconUri(partnerIconPath: string) {
  return `${EDGE_CONTENT_SERVER_URI}/${partnerIconPath}`
}

/**
 * Themed Icons
 */
export const getThemedIconUri = (theme: Theme, path: string) => {
  return `${theme.iconServerBaseUri}/${path}.png`
}

export const getUi4ImageUri = (theme: Theme, path: string) => {
  return `${EDGE_CONTENT_SERVER_URI}/UI4/${path}.png?`
}
