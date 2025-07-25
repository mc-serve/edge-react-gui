import { EdgeCurrencyWallet } from 'edge-core-js'
import * as React from 'react'

import { SPECIAL_CURRENCY_INFO } from '../../constants/WalletAndCurrencyConstants'
import { useSelector } from '../../types/reactRedux'
import { CryptoIcon } from '../icons/CryptoIcon'
import { CryptoText } from '../text/CryptoText'
import { FiatText } from '../text/FiatText'
import { IconDataRow } from './IconDataRow'

// For display of custom assets such as AAVE collateral tokens
export interface CustomAsset {
  displayName: string
  currencyCode: string
  // TODO: Update after hidden assets are supported in accountbased
  nativeBalance: string
  // Token referenced for its exchange rate and icon
  referenceTokenId: string
  wallet: EdgeCurrencyWallet
}

interface Props {
  customAsset: CustomAsset
  marginRem?: number[] | number
}

/**
 * A view representing the data from a custom asset, used for rows, cards, etc.
 */
const CustomAssetRowComponent = (props: Props) => {
  const { customAsset, marginRem } = props
  const { wallet, referenceTokenId, displayName, currencyCode, nativeBalance } =
    customAsset
  const { pluginId } = wallet.currencyInfo
  const { showTokenNames = false } = SPECIAL_CURRENCY_INFO[pluginId] ?? {}

  // Balance stuff:
  const showBalance = useSelector(
    state => state.ui.settings.isAccountBalanceVisible
  )
  const cryptoText = showBalance ? (
    <CryptoText
      wallet={wallet}
      tokenId={referenceTokenId}
      nativeAmount={nativeBalance}
      withSymbol
    />
  ) : null
  const fiatText = showBalance ? (
    <FiatText
      nativeCryptoAmount={nativeBalance}
      tokenId={referenceTokenId}
      currencyConfig={wallet.currencyConfig}
    />
  ) : null

  const icon = (
    <CryptoIcon sizeRem={2} tokenId={referenceTokenId} pluginId={pluginId} />
  )

  let displayCurrencyCode = currencyCode
  const tokenFromId = wallet.currencyConfig.allTokens[referenceTokenId]
  if (showTokenNames && tokenFromId != null) {
    displayCurrencyCode = `${tokenFromId.displayName}`
  }

  return (
    <IconDataRow
      icon={icon}
      leftText={displayCurrencyCode}
      leftSubtext={displayName}
      rightText={cryptoText}
      rightSubText={fiatText}
      marginRem={marginRem}
    />
  )
}

export const CustomAssetRow = React.memo(CustomAssetRowComponent)
