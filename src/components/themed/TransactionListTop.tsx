import { add, gt, mul, round } from 'biggystring'
import {
  EdgeAccount,
  EdgeBalanceMap,
  EdgeCurrencyWallet,
  EdgeDenomination,
  EdgeTokenId
} from 'edge-core-js'
import * as React from 'react'
import { View } from 'react-native'
import { AirshipBridge } from 'react-native-airship'
import AntDesignIcon from 'react-native-vector-icons/AntDesign'
import Entypo from 'react-native-vector-icons/Entypo'
import Feather from 'react-native-vector-icons/Feather'
import FontAwesomeIcon from 'react-native-vector-icons/FontAwesome'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { sprintf } from 'sprintf-js'

import { checkAndShowLightBackupModal } from '../../actions/BackupModalActions'
import { toggleAccountBalanceVisibility } from '../../actions/LocalSettingsActions'
import { updateStakingState } from '../../actions/scene/StakingActions'
import {
  getFiatSymbol,
  SPECIAL_CURRENCY_INFO
} from '../../constants/WalletAndCurrencyConstants'
import { useAsyncNavigation } from '../../hooks/useAsyncNavigation'
import { useAsyncValue } from '../../hooks/useAsyncValue'
import { useHandler } from '../../hooks/useHandler'
import { useWalletName } from '../../hooks/useWalletName'
import { useWatch } from '../../hooks/useWatch'
import { formatNumber } from '../../locales/intl'
import { lstrings } from '../../locales/strings'
import { getStakePlugins } from '../../plugins/stake-plugins/stakePlugins'
import {
  PositionAllocation,
  StakePlugin,
  StakePolicy
} from '../../plugins/stake-plugins/types'
import {
  defaultWalletStakingState,
  StakePositionMap,
  WalletStakingState
} from '../../reducers/StakingReducer'
import {
  getExchangeDenom,
  selectDisplayDenom
} from '../../selectors/DenominationSelectors'
import { getExchangeRate } from '../../selectors/WalletSelectors'
import { config } from '../../theme/appConfig'
import { useDispatch, useSelector } from '../../types/reactRedux'
import { Dispatch } from '../../types/reduxTypes'
import { NavigationBase, WalletsTabSceneProps } from '../../types/routerTypes'
import { GuiExchangeRates } from '../../types/types'
import { CryptoAmount } from '../../util/CryptoAmount'
import { isKeysOnlyPlugin } from '../../util/CurrencyInfoHelpers'
import { triggerHaptic } from '../../util/haptic'
import {
  getBestApyText,
  getFioStakingBalances,
  getPluginFromPolicyId,
  getPoliciesFromPlugins,
  getPositionAllocations,
  isStakingSupported
} from '../../util/stakeUtils'
import { getUkCompliantString } from '../../util/ukComplianceUtils'
import {
  convertNativeToDenomination,
  DECIMAL_PRECISION,
  removeIsoPrefix,
  zeroString
} from '../../util/utils'
import { IconButton } from '../buttons/IconButton'
import { EdgeCard } from '../cards/EdgeCard'
import { VisaCardCard } from '../cards/VisaCardCard'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { WalletIcon } from '../icons/WalletIcon'
import { EdgeModal } from '../modals/EdgeModal'
import { WalletListMenuModal } from '../modals/WalletListMenuModal'
import { WalletListModal, WalletListResult } from '../modals/WalletListModal'
import { Airship, showError } from '../services/AirshipInstance'
import {
  cacheStyles,
  Theme,
  ThemeProps,
  useTheme
} from '../services/ThemeContext'
import { EdgeText } from './EdgeText'
import { SelectableRow } from './SelectableRow'

const SWAP_ASSET_PRIORITY: Array<{ pluginId: string; tokenId: EdgeTokenId }> = [
  { pluginId: 'bitcoin', tokenId: null },
  { pluginId: 'ethereum', tokenId: null },
  { pluginId: 'ethereum', tokenId: 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }, // USDC
  { pluginId: 'polygon', tokenId: '3c499c542cef5e3811e1192ce70d8cc03d5c3359' }, // USDC
  { pluginId: 'ethereum', tokenId: 'dac17f958d2ee523a2206206994597c13d831ec7' }, // USDT
  { pluginId: 'polygon', tokenId: 'c2132d05d31c914a87c6611c10748aeb04b58e8f' }, // USDT
  { pluginId: 'binancesmartchain', tokenId: null },
  { pluginId: 'solana', tokenId: null },
  { pluginId: 'xrp', tokenId: null },
  { pluginId: 'dogecoin', tokenId: null },
  { pluginId: 'avalanche', tokenId: null },
  { pluginId: 'polygon', tokenId: null }
]

interface OwnProps {
  navigation: WalletsTabSceneProps<'walletDetails'>['navigation']

  isLightAccount: boolean

  // Wallet identity:
  tokenId: EdgeTokenId
  wallet: EdgeCurrencyWallet

  // Scene state:
  isEmpty: boolean
  searching: boolean
}

interface StateProps {
  account: EdgeAccount
  balanceMap: EdgeBalanceMap
  currencyCode: string
  countryCode?: string
  defaultFiat: string
  dispatch: Dispatch
  displayDenomination: EdgeDenomination
  exchangeDenomination: EdgeDenomination
  exchangeRate: number
  exchangeRates: GuiExchangeRates
  isAccountBalanceVisible: boolean
  stakePlugins: StakePlugin[]
  stakePolicies: StakePolicy[]
  stakePositionMap: StakePositionMap
  lockedNativeAmount: string
  walletName: string
}

interface DispatchProps {
  toggleBalanceVisibility: () => void
}

type Props = OwnProps & StateProps & DispatchProps & ThemeProps

export class TransactionListTopComponent extends React.PureComponent<Props> {
  componentDidUpdate(prevProps: Props) {
    // Update staking policies if the wallet changes
    if (prevProps.wallet !== this.props.wallet) {
      this.props
        .dispatch(
          updateStakingState(this.props.currencyCode, this.props.wallet)
        )
        .catch(err => showError(err))
    } else if (prevProps.tokenId !== this.props.tokenId) {
      // Update staked amount if the tokenId changes but the wallet remains the same
      let total = '0'
      let lockedNativeAmount = '0'
      for (const stakePosition of Object.values(this.props.stakePositionMap)) {
        const { staked, earned } = getPositionAllocations(stakePosition)
        total = this.getTotalPosition(this.props.currencyCode, [
          ...staked,
          ...earned
        ])
        lockedNativeAmount = add(lockedNativeAmount, total)
      }
      this.props.dispatch({
        type: 'STAKING/UPDATE_LOCKED_AMOUNT',
        walletId: this.props.wallet.id,
        lockedNativeAmount
      })
    }
  }

  componentDidMount() {
    this.props
      .dispatch(updateStakingState(this.props.currencyCode, this.props.wallet))
      .catch(err => showError(err))
  }

  getTotalPosition = (
    currencyCode: string,
    positions: PositionAllocation[]
  ): string => {
    const { pluginId } = this.props.wallet.currencyInfo
    const amount = positions
      .filter(p => p.currencyCode === currencyCode && p.pluginId === pluginId)
      .reduce((prev, curr) => add(prev, curr.nativeAmount), '0')
    return amount
  }

  handleOpenWalletListModal = () => {
    const { account, navigation, wallet: parentWallet, tokenId } = this.props

    triggerHaptic('impactLight')
    Airship.show<WalletListResult>(bridge => (
      <WalletListModal
        bridge={bridge}
        parentWalletId={tokenId == null ? undefined : parentWallet.id}
        headerTitle={lstrings.select_wallet}
        navigation={navigation as NavigationBase}
      />
    ))
      .then(result => {
        if (result?.type === 'wallet') {
          const { tokenId, walletId } = result
          const wallet = account.currencyWallets[walletId]
          if (wallet == null) return
          navigation.setParams({ tokenId, walletId })
        }
      })
      .catch(err => showError(err))
  }

  handleMenu = () => {
    const { wallet, tokenId, navigation } = this.props
    triggerHaptic('impactLight')
    Airship.show(bridge => (
      <WalletListMenuModal
        bridge={bridge}
        tokenId={tokenId}
        navigation={navigation}
        walletId={wallet.id}
      />
    )).catch(err => showError(err))
  }

  handleTrade = async () => {
    const { theme, wallet, tokenId } = this.props
    const styles = getStyles(theme)

    const buySellIconProps = {
      size: theme.rem(1.25),
      color: theme.iconTappable
    }
    const sceneCurrencyCode =
      tokenId == null
        ? wallet.currencyInfo.currencyCode
        : wallet.currencyConfig.allTokens[tokenId].currencyCode

    await Airship.show(bridge => (
      <EdgeModal
        bridge={bridge}
        title={sprintf(lstrings.trade_s, sceneCurrencyCode)}
        onCancel={() => {
          bridge.resolve()
        }}
      >
        <SelectableRow
          marginRem={0.5}
          title={sprintf(lstrings.buy_1s, sceneCurrencyCode)}
          onPress={() => this.handleTradeBuy(bridge)}
          icon={
            <View style={styles.dualIconContainer}>
              <FontAwesomeIcon name="bank" {...buySellIconProps} />
              <AntDesignIcon name="arrowright" {...buySellIconProps} />
            </View>
          }
        />
        <SelectableRow
          marginRem={0.5}
          title={sprintf(lstrings.sell_1s, sceneCurrencyCode)}
          onPress={() => this.handleTradeSell(bridge)}
          icon={
            <View style={styles.dualIconContainer}>
              <AntDesignIcon name="arrowright" {...buySellIconProps} />
              <FontAwesomeIcon name="bank" {...buySellIconProps} />
            </View>
          }
        />
        {!config.disableSwaps ? (
          <SelectableRow
            marginRem={0.5}
            title={sprintf(lstrings.swap_s_to_from_crypto, sceneCurrencyCode)}
            onPress={() => this.handleTradeSwap(bridge)}
            icon={
              <View style={styles.singleIconContainer}>
                <Ionicons
                  name="swap-horizontal"
                  size={theme.rem(2.5)}
                  color={theme.iconTappable}
                />
              </View>
            }
          />
        ) : null}
      </EdgeModal>
    ))
  }

  handleTradeBuy = (bridge: AirshipBridge<void>) => {
    const { navigation, wallet, tokenId } = this.props
    const forcedWalletResult: WalletListResult = {
      type: 'wallet',
      walletId: wallet.id,
      tokenId
    }

    navigation.navigate('buyTab', {
      screen: 'pluginListBuy',
      params: { forcedWalletResult }
    })
    bridge.resolve()
  }

  handleTradeSell = (bridge: AirshipBridge<void>) => {
    const { navigation, wallet, tokenId } = this.props
    const forcedWalletResult: WalletListResult = {
      type: 'wallet',
      walletId: wallet.id,
      tokenId
    }

    navigation.navigate('sellTab', {
      screen: 'pluginListSell',
      params: { forcedWalletResult }
    })
    bridge.resolve()
  }

  handleTradeSwap = (bridge?: AirshipBridge<void>) => {
    const { account, navigation, wallet, tokenId } = this.props

    const sceneWallet = wallet
    const sceneTokenId = tokenId
    const { currencyWallets } = account
    const { exchangeRates } = this.props

    // Check balances for the displayed asset on this scene:
    const sceneAssetCryptoBalance = wallet.balanceMap.get(tokenId)

    // Constructs an array to store information about owned assets. This array
    // will be filled with assets that satisfy the following:
    // 1. Are defined in the SWAP_ASSET_PRIORITY array
    // 2. Match wallets owned by the user
    // 3. Match the wallets' enabled tokens
    const ownedAssets: Array<{
      pluginId: string
      tokenId: EdgeTokenId
      walletId: string
      dollarValue: number
    }> = []
    SWAP_ASSET_PRIORITY.forEach(priorityAsset => {
      Object.values(currencyWallets).forEach(currencyWallet => {
        // Check if this wallet is the same asset as the one shown on the scene.
        // This is used later to prevent selecting the same asset as both source
        // and destination in a swap.
        const isSceneAssetMatch =
          currencyWallet.currencyInfo.pluginId ===
            sceneWallet.currencyInfo.pluginId &&
          (sceneTokenId == null ||
            currencyWallet.enabledTokenIds.includes(sceneTokenId))

        // Checks if the current wallet or enabled token matches one of the
        // priority assets for swapping.
        const isPriorityAssetMatch =
          currencyWallet.currencyInfo.pluginId === priorityAsset.pluginId &&
          (priorityAsset.tokenId == null ||
            currencyWallet.enabledTokenIds.some(
              enabledTokenId => enabledTokenId === priorityAsset.tokenId
            ))

        // If the wallet or enabled tokens has a priority swap asset match,
        // calculate its USD value and add it to the ownedAssets array along
        // with the corresponding wallet information.
        if (!isSceneAssetMatch && isPriorityAssetMatch) {
          // Store the balance in USD along with the corresponding wallet info
          // in ownedAssets
          const cryptoAmount = new CryptoAmount({
            currencyConfig: currencyWallet.currencyConfig,
            tokenId: priorityAsset.tokenId,
            nativeAmount:
              currencyWallet.balanceMap.get(priorityAsset.tokenId) ?? '0'
          })
          const dollarValue = parseFloat(
            cryptoAmount.displayDollarValue(exchangeRates, DECIMAL_PRECISION)
          )

          ownedAssets.push({
            pluginId: priorityAsset.pluginId,
            tokenId: priorityAsset.tokenId,
            walletId: currencyWallet.id,
            dollarValue
          })
        }
      })
    })

    let highestUsdBalanceAccountWalletId
    let highestUsdBalancePriorityTokenId: EdgeTokenId = null

    if (ownedAssets.length > 0) {
      // Sort by highest dollar value
      ownedAssets.sort((a, b) => b.dollarValue - a.dollarValue)

      // Use the highest in the priority asset list as the other side of
      // the swap.
      // NOTE: If we don't have exchange rates for one or more assets, or the
      // balances for owned wallets/enabled tokens are zero, we would *still*
      // retain the ordering set forth by SWAP_ASSET_PRIORITY to use for this
      // pick.
      highestUsdBalanceAccountWalletId = ownedAssets[0].walletId
      highestUsdBalancePriorityTokenId = ownedAssets[0].tokenId
    } else {
      // If no owned assets match those defined in the SWAP_ASSET_PRIORITY list,
      // we leave the opposing swap field blank. Allow the user to choose in
      // this case.
    }

    // Determine the "FROM" and "TO" assets:
    // Use the highest USD balance priority asset as the to or from asset,
    // depending on if there is a crypto balance for the scene asset
    let fromWalletId, fromTokenId, toWalletId, toTokenId
    if (zeroString(sceneAssetCryptoBalance)) {
      // No crypto balance for the asset shown on this scene.
      // Use the scene asset as the "TO" swap side
      toWalletId = sceneWallet.id
      toTokenId = sceneTokenId

      // Priority asset as the "FROM" swap side.
      if (highestUsdBalanceAccountWalletId != null) {
        const fromWallet = currencyWallets[highestUsdBalanceAccountWalletId]
        fromWalletId = fromWallet.id
        fromTokenId = highestUsdBalancePriorityTokenId
      } else {
        // Null highest USD balance implies the user no owns no wallets or
        // enabled tokenIds that match those defined in the SWAP_ASSET_PRIORITY
        // list. Allow the user to choose in this case.
      }
    } else {
      // We have balance for the asset shown on this scene
      // Use the scene asset as the "FROM" swap side
      fromWalletId = sceneWallet.id
      fromTokenId = sceneTokenId

      // Priority asset as the "TO" swap side
      if (highestUsdBalanceAccountWalletId != null) {
        const toWallet = currencyWallets[highestUsdBalanceAccountWalletId]
        toWalletId = toWallet.id
        toTokenId = highestUsdBalancePriorityTokenId
      } else {
        // Null highest USD balance implies the user no owns no wallets or
        // enabled tokenIds that match those defined in the SWAP_ASSET_PRIORITY
        // list. Allow the user to choose in this case.
      }
    }

    // Finally, navigate to the scene with these props
    navigation.navigate('swapTab', {
      screen: 'swapCreate',
      params: {
        fromWalletId,
        fromTokenId,
        toWalletId,
        toTokenId
      }
    })

    if (bridge != null) bridge.resolve()
  }

  renderBalanceBox = () => {
    // TODO: Use CryptoText/FiatText and/or CryptoAmount after they are extended
    // to gracefully handle edge cases such as explicit no rounding and scaling.
    const {
      balanceMap,
      displayDenomination,
      exchangeDenomination,
      exchangeRate,
      isAccountBalanceVisible,
      theme,
      tokenId,
      wallet,
      walletName,
      defaultFiat
    } = this.props
    const styles = getStyles(theme)

    const fiatSymbol = getFiatSymbol(defaultFiat)

    const nativeBalance = balanceMap.get(tokenId) ?? '0'
    const cryptoAmount = convertNativeToDenomination(
      displayDenomination.multiplier
    )(nativeBalance) // convert to correct denomination
    const cryptoAmountFormat = formatNumber(add(cryptoAmount, '0'))

    // Fiat Balance Formatting
    const exchangeAmount = convertNativeToDenomination(
      exchangeDenomination.multiplier
    )(nativeBalance)
    const fiatBalance = parseFloat(exchangeAmount) * exchangeRate
    const fiatBalanceFormat = formatNumber(
      fiatBalance && fiatBalance > 0.000001 ? fiatBalance : 0,
      { toFixed: 2 }
    )

    return (
      <>
        <View style={styles.balanceBoxWalletNameCurrencyContainer}>
          <EdgeTouchableOpacity
            accessible={false}
            style={styles.balanceBoxWalletNameContainer}
            onPress={this.handleOpenWalletListModal}
          >
            <WalletIcon
              marginRem={[0, 0.25, 0, 0]}
              sizeRem={1}
              tokenId={tokenId}
              wallet={wallet}
            />
            <EdgeText accessible style={styles.balanceBoxWalletName}>
              {walletName}
            </EdgeText>
          </EdgeTouchableOpacity>
          <EdgeTouchableOpacity
            testID="gearIcon"
            onPress={this.handleMenu}
            style={styles.settingsTouchContainer}
          >
            <Entypo
              accessibilityHint={lstrings.wallet_settings_label}
              color={theme.icon}
              name="dots-three-vertical"
              size={theme.rem(1)}
            />
          </EdgeTouchableOpacity>
        </View>
        <EdgeTouchableOpacity
          accessible={false}
          onPress={this.props.toggleBalanceVisibility}
        >
          <View style={styles.balanceBoxCryptoBalanceContainer}>
            <EdgeText
              accessible
              style={styles.balanceBoxCurrency}
              minimumFontScale={0.25}
              numberOfLines={1}
            >
              {(isAccountBalanceVisible
                ? cryptoAmountFormat
                : lstrings.redacted_placeholder) +
                ' ' +
                displayDenomination.name}
            </EdgeText>
            <Ionicons
              name={isAccountBalanceVisible ? 'eye-off-outline' : 'eye-outline'}
              style={styles.eyeIcon}
              color={theme.iconTappable}
              size={theme.rem(1.15)}
            />
          </View>
          <EdgeText accessible style={styles.balanceFiatBalance}>
            {fiatSymbol +
              (isAccountBalanceVisible
                ? fiatBalanceFormat
                : ' ' + lstrings.redacted_placeholder) +
              ' ' +
              defaultFiat}
          </EdgeText>
        </EdgeTouchableOpacity>
      </>
    )
  }

  /**
   * If the parent chain supports staking, query the info server if staking is
   * supported for this specific asset. While waiting for the query, show a
   * spinner.
   */
  renderStakedBalance() {
    const {
      theme,
      wallet,
      defaultFiat,
      displayDenomination,
      exchangeDenomination,
      exchangeRate,
      lockedNativeAmount
    } = this.props
    const styles = getStyles(theme)

    if (
      SPECIAL_CURRENCY_INFO[wallet.currencyInfo.pluginId]
        ?.isStakingSupported !== true
    )
      return null

    const fiatSymbol = getFiatSymbol(defaultFiat)

    const { locked } = getFioStakingBalances(wallet.stakingStatus)

    const walletBalanceLocked = locked
    const nativeLocked = add(walletBalanceLocked, lockedNativeAmount)
    if (nativeLocked === '0') return null

    const stakingCryptoAmount = convertNativeToDenomination(
      displayDenomination.multiplier
    )(nativeLocked)
    const stakingCryptoAmountFormat = formatNumber(
      add(stakingCryptoAmount, '0')
    )

    const stakingExchangeAmount = convertNativeToDenomination(
      exchangeDenomination.multiplier
    )(nativeLocked)
    const stakingFiatBalance = mul(stakingExchangeAmount, exchangeRate)
    const stakingFiatBalanceFormat = formatNumber(
      stakingFiatBalance && gt(stakingFiatBalance, '0.000001')
        ? stakingFiatBalance
        : 0,
      { toFixed: 2 }
    )

    return (
      <View style={styles.stakingBoxContainer}>
        <EdgeText style={styles.stakingStatusText}>
          {sprintf(
            lstrings.staking_status,
            stakingCryptoAmountFormat + ' ' + displayDenomination.name,
            fiatSymbol + stakingFiatBalanceFormat + ' ' + defaultFiat
          )}
        </EdgeText>
      </View>
    )
  }

  renderButtons() {
    const { theme, stakePolicies, countryCode } = this.props
    const styles = getStyles(theme)
    const hideStaking = !this.isStakingAvailable()
    const bestApyText = getBestApyText(stakePolicies)

    // For UK compliance, we only allow swap without buy/sell, so we don't need
    // to show the trade modal in all cases, and if swap is disabled, we don't
    // show this button at all.
    const hideSwap = config.disableSwaps && countryCode === 'GB'

    return (
      <View style={styles.buttonsContainer}>
        <IconButton
          label={lstrings.fragment_request_subtitle}
          onPress={this.handleRequest}
        >
          <Ionicons
            name="arrow-down"
            size={theme.rem(2)}
            color={theme.primaryText}
          />
        </IconButton>
        <IconButton
          label={lstrings.fragment_send_subtitle}
          onPress={this.handleSend}
        >
          <Ionicons
            name="arrow-up"
            size={theme.rem(2)}
            color={theme.primaryText}
          />
        </IconButton>
        {hideStaking ? null : (
          <IconButton
            disabled={
              this.props.stakePlugins.length === 0 &&
              this.props.wallet.currencyInfo.pluginId !== 'fio'
            }
            label={getUkCompliantString(countryCode, 'stake_earn_button_label')}
            onPress={this.handleStakePress}
            superscriptLabel={bestApyText}
          >
            <Feather
              name="percent"
              size={theme.rem(1.75)}
              color={theme.primaryText}
            />
          </IconButton>
        )}
        {hideSwap ? null : (
          <IconButton
            label={lstrings.trade_currency}
            onPress={
              countryCode === 'GB'
                ? () => this.handleTradeSwap()
                : this.handleTrade
            }
          >
            <Ionicons
              name="swap-horizontal"
              size={theme.rem(2)}
              color={theme.primaryText}
            />
          </IconButton>
        )}
      </View>
    )
  }

  isStakingAvailable = (): boolean => {
    return (
      isStakingSupported(this.props.wallet.currencyInfo.pluginId) &&
      (Object.keys(this.props.stakePolicies).length > 0 ||
        // FIO was the first staking-enabled currency and doesn't use staking policies yet
        this.props.wallet.currencyInfo.pluginId === 'fio')
    )
  }

  /** Return the best APY found, defaulting to 1 decimal place, rounding to the
   * nearest whole number if >= 10, and truncating to '>99%' if greater than 99%
   * */
  getBestApy = (): string | undefined => {
    const { stakePolicies } = this.props
    if (stakePolicies.length === 0) return
    const bestApy = stakePolicies.reduce(
      (prev, curr) => Math.max(prev, curr.apy ?? 0),
      0
    )
    if (bestApy === 0) return

    const precision = Math.log10(bestApy) > 1 ? 0 : -1
    return round(bestApy.toString(), precision) + '%'
  }

  handleRequest = (): void => {
    const { account, navigation, tokenId, wallet } = this.props

    triggerHaptic('impactLight')
    if (!checkAndShowLightBackupModal(account, navigation as NavigationBase)) {
      navigation.push('request', { tokenId, walletId: wallet.id })
    }
  }

  handleSend = (): void => {
    const { navigation } = this.props

    triggerHaptic('impactLight')
    const { wallet, tokenId } = this.props
    navigation.push('send2', {
      walletId: wallet.id,
      tokenId,
      hiddenFeaturesMap: { scamWarning: false }
    })
  }

  handleStakePress = () => {
    triggerHaptic('impactLight')
    const { currencyCode, wallet, navigation, stakePolicies, tokenId } =
      this.props
    const { stakePlugins } = this.props

    // Handle FIO staking
    if (currencyCode === 'FIO') {
      navigation.push('fioStakingOverview', {
        tokenId,
        walletId: wallet.id
      })
      return
    }

    // Handle StakePlugin staking
    if (stakePolicies.length === 1) {
      const stakePolicyId = stakePolicies[0].stakePolicyId
      const stakePlugin = getPluginFromPolicyId(stakePlugins, stakePolicyId, {
        pluginId: wallet.currencyInfo.pluginId
      })
      if (stakePlugin != null)
        navigation.push('stakeOverview', {
          stakePlugin,
          walletId: wallet.id,
          stakePolicyId
        })
    } else {
      // More than one option or stakePolicies are not yet loaded/populated
      navigation.push('stakeOptions', {
        walletId: wallet.id,
        currencyCode
      })
    }
  }

  render() {
    const { wallet, isEmpty, searching, tokenId, navigation } = this.props
    const showStakedBalance = this.isStakingAvailable()

    return (
      <>
        {searching ? null : (
          <>
            <EdgeCard paddingRem={1}>
              {this.renderBalanceBox()}
              {!showStakedBalance ? null : this.renderStakedBalance()}
            </EdgeCard>
            {this.renderButtons()}
          </>
        )}
        {isEmpty || searching ? null : (
          <VisaCardCard
            wallet={wallet}
            tokenId={tokenId}
            navigation={navigation}
          />
        )}
      </>
    )
  }
}

const getStyles = cacheStyles((theme: Theme) => ({
  // Balance Box
  balanceBoxContainer: {
    marginTop: theme.rem(1.5)
  },
  balanceBoxWalletNameCurrencyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.rem(0.5)
  },
  balanceBoxWalletNameContainer: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.cardBaseColor,
    borderRadius: 100,
    paddingHorizontal: theme.rem(0.75),
    paddingVertical: theme.rem(0.25),
    marginRight: theme.rem(0.5)
  },
  balanceBoxCryptoBalanceContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1
  },
  balanceBoxWalletName: {
    flexShrink: 1,
    fontSize: theme.rem(0.75),
    lineHeight: theme.rem(1.5)
  },
  balanceBoxCurrency: {
    fontSize: theme.rem(1.75),
    fontFamily: theme.fontFaceMedium,
    flexShrink: 1
  },
  balanceFiatBalance: {
    fontSize: theme.rem(1.25)
  },
  eyeIcon: {
    marginLeft: theme.rem(0.5),
    marginRight: theme.rem(0),
    flexGrow: 1,
    alignSelf: 'center',
    ...theme.cardTextShadow
  },
  settingsTouchContainer: {
    alignSelf: 'center',

    // Extra tappability:
    margin: -theme.rem(0.75),
    padding: theme.rem(0.75),

    // Asymmetric adjustments to above margin/paddings:
    paddingRight: theme.rem(0.5),

    // Whitespace adjustments:
    marginRight: -theme.rem(0.75)
  },
  // Send/Receive/Earn/Trade Buttons
  buttonsContainer: {
    flexShrink: 1,
    flexDirection: 'row',
    justifyContent: 'space-evenly'
  },
  buttons: {
    flexShrink: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  },
  buttonsText: {
    fontSize: theme.rem(1),
    color: theme.textLink,
    fontFamily: theme.fontFaceMedium
  },

  // Trade modal
  dualIconContainer: {
    flexDirection: 'row',
    paddingVertical: theme.rem(0.5),
    width: theme.rem(2.5)
  },
  singleIconContainer: {
    flexDirection: 'row',
    width: theme.rem(2.5)
  },

  // Transactions Divider
  transactionsDividerText: {
    fontFamily: theme.fontFaceMedium
  },

  // Staking Box
  stakingBoxContainer: {
    height: theme.rem(1.25),
    minWidth: theme.rem(18),
    maxWidth: '70%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  stakingStatusText: {
    color: theme.secondaryText,
    maxWidth: '70%',
    fontSize: theme.rem(1)
  }
}))

export function TransactionListTop(props: OwnProps) {
  const { tokenId, wallet, navigation } = props
  const dispatch = useDispatch()
  const account = useSelector(state => state.core.account)
  const exchangeRates = useSelector(state => state.exchangeRates)
  const defaultIsoFiat = useSelector(state => state.ui.settings.defaultIsoFiat)
  const countryCode = useSelector(state => state.ui.countryCode)
  const walletStakingState: WalletStakingState = useSelector(
    // Fallback to a default state using the reducer if the wallet is not found
    state =>
      state.staking.walletStakingMap[wallet.id] ?? defaultWalletStakingState
  )
  const { stakePositionMap, lockedNativeAmount } = walletStakingState

  const defaultFiat = removeIsoPrefix(defaultIsoFiat)
  const theme = useTheme()

  const { currencyCode } =
    tokenId == null
      ? wallet.currencyInfo
      : wallet.currencyConfig.allTokens[tokenId]

  const [stakePlugins = []] = useAsyncValue<StakePlugin[]>(
    async () => await getStakePlugins(wallet.currencyInfo.pluginId)
  )
  const stakePolicies = getPoliciesFromPlugins(
    stakePlugins,
    stakePositionMap,
    wallet,
    currencyCode
  )

  const displayDenomination = useSelector(state =>
    selectDisplayDenom(state, wallet.currencyConfig, tokenId)
  )
  const exchangeDenomination = getExchangeDenom(wallet.currencyConfig, tokenId)
  const exchangeRate = useSelector(state =>
    getExchangeRate(state, currencyCode, defaultIsoFiat)
  )
  const isAccountBalanceVisible = useSelector(
    state => state.ui.settings.isAccountBalanceVisible
  )

  const walletName = useWalletName(wallet)
  const balanceMap = useWatch(wallet, 'balanceMap')

  const navigationDebounced = useAsyncNavigation(navigation)

  const handleBalanceVisibility = useHandler(() => {
    dispatch(toggleAccountBalanceVisibility())
  })

  return (
    <TransactionListTopComponent
      {...props}
      navigation={navigationDebounced}
      account={account}
      balanceMap={balanceMap}
      countryCode={countryCode}
      currencyCode={currencyCode}
      defaultFiat={defaultFiat}
      dispatch={dispatch}
      displayDenomination={displayDenomination}
      exchangeDenomination={exchangeDenomination}
      exchangeRate={
        isKeysOnlyPlugin(wallet.currencyInfo.pluginId) ? 0 : exchangeRate
      }
      isAccountBalanceVisible={isAccountBalanceVisible}
      exchangeRates={exchangeRates}
      toggleBalanceVisibility={handleBalanceVisibility}
      theme={theme}
      walletName={walletName}
      stakePlugins={stakePlugins}
      stakePolicies={stakePolicies}
      stakePositionMap={stakePositionMap}
      lockedNativeAmount={lockedNativeAmount}
    />
  )
}
