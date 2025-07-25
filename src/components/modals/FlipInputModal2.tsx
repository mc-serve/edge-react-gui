import { div, log10, toFixed } from 'biggystring'
import { EdgeCurrencyWallet, EdgeTokenId } from 'edge-core-js'
import * as React from 'react'
import { memo, useState } from 'react'
import { View } from 'react-native'
import { AirshipBridge } from 'react-native-airship'
import FontAwesomeIcon from 'react-native-vector-icons/FontAwesome'
import { sprintf } from 'sprintf-js'

import { useDisplayDenom } from '../../hooks/useDisplayDenom'
import { useHandler } from '../../hooks/useHandler'
import { useWalletName } from '../../hooks/useWalletName'
import { useWatch } from '../../hooks/useWatch'
import { formatNumber } from '../../locales/intl'
import { lstrings } from '../../locales/strings'
import { DECIMAL_PRECISION } from '../../util/utils'
import { ReturnKeyTypeButton } from '../buttons/ReturnKeyTypeButton'
import { EdgeCard } from '../cards/EdgeCard'
import { EdgeTouchableWithoutFeedback } from '../common/EdgeTouchableWithoutFeedback'
import { ExchangeRate2 } from '../common/ExchangeRate2'
import { cacheStyles, Theme, useTheme } from '../services/ThemeContext'
import { FiatText } from '../text/FiatText'
import { EdgeText } from '../themed/EdgeText'
import {
  ExchangedFlipInput2,
  ExchangedFlipInputAmounts,
  ExchangedFlipInputRef,
  ExchangeFlipInputFields
} from '../themed/ExchangedFlipInput2'
import { EdgeModal } from './EdgeModal'

export interface FlipInputModalResult {
  nativeAmount: string
  exchangeAmount: string
  fiatAmount: string
}

export interface SetFeesParams {
  feeTokenId: EdgeTokenId
  feeNativeAmount: string
}
export interface FlipInputModalRef {
  setFees: (params: SetFeesParams) => void
  setAmount: (field: ExchangeFlipInputFields, value: string) => void
  setError: (errorMessage: string | null) => void
}

type FeeStyleTypes = 'dangerText' | 'warningText'

interface Props {
  bridge: AirshipBridge<FlipInputModalResult>
  wallet: EdgeCurrencyWallet
  tokenId: EdgeTokenId
  startNativeAmount?: string
  forceField?: ExchangeFlipInputFields
  // Fees
  feeTokenId: EdgeTokenId
  feeNativeAmount?: string
  feeStyle?: FeeStyleTypes
  onFeesChange?: () => void
  onMaxSet?: () => void
  onAmountsChanged?: (amounts: ExchangedFlipInputAmounts) => void
  headerText?: string
  hideMaxButton?: boolean
}

const FlipInputModal2Component = React.forwardRef<FlipInputModalRef, Props>(
  (props: Props, ref) => {
    const {
      bridge,
      wallet,
      tokenId,
      startNativeAmount,
      forceField,
      onAmountsChanged,
      feeTokenId: startingFeeTokenId,
      feeNativeAmount: startingFeeNativeAmount = '',
      feeStyle,
      onFeesChange,
      onMaxSet,
      headerText,
      hideMaxButton
    } = props

    const exchangedFlipInputRef = React.useRef<ExchangedFlipInputRef>(null)

    const balanceMap = useWatch(wallet, 'balanceMap')
    const [feeTokenId, setFeeTokenId] =
      useState<EdgeTokenId>(startingFeeTokenId)
    const [feeNativeAmount, setFeeNativeAmount] = useState<string>(
      startingFeeNativeAmount
    )
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [amounts, setAmounts] = useState<ExchangedFlipInputAmounts>({
      nativeAmount: '',
      exchangeAmount: '',
      fiatAmount: '',
      fieldChanged: forceField ?? 'fiat'
    })

    const displayDenom = useDisplayDenom(wallet.currencyConfig, tokenId)
    const feeDisplayDenom = useDisplayDenom(wallet.currencyConfig, feeTokenId)
    const walletName = useWalletName(wallet)

    const flipInputHeaderText =
      headerText ?? sprintf(lstrings.send_from_wallet, walletName)
    const theme = useTheme()
    const styles = getStyles(theme)

    const handleAmountsChanged = useHandler(
      (amounts: ExchangedFlipInputAmounts) => {
        setAmounts(amounts)

        if (onAmountsChanged != null) onAmountsChanged(amounts)
      }
    )

    const handleFeesChange = useHandler(() => {
      if (onFeesChange != null) {
        handleCloseModal()
        onFeesChange()
      }
    })

    const handleCloseModal = useHandler(() => {
      let { nativeAmount, exchangeAmount, fiatAmount } = amounts
      nativeAmount = nativeAmount === '' ? '0' : nativeAmount
      exchangeAmount = exchangeAmount === '' ? '0' : exchangeAmount
      fiatAmount = fiatAmount === '' ? '0' : fiatAmount
      bridge.resolve({ nativeAmount, exchangeAmount, fiatAmount })
    })

    const handleSendMaxAmount = useHandler(() => {
      if (onMaxSet != null) {
        onMaxSet()
        handleCloseModal()
      }
    })

    const renderErrorMessage = () => {
      const opacity = errorMessage == null ? 0 : 1
      return (
        <EdgeText
          numberOfLines={1}
          style={[styles.exchangeRateErrorText, { opacity }]}
        >
          {errorMessage == null ? ' ' : errorMessage.split('\n')[0]}
        </EdgeText>
      )
    }

    const renderExchangeRates = () => {
      return (
        <View style={styles.rateBalanceContainer}>
          <EdgeText style={styles.secondaryTitle}>
            {lstrings.string_rate}
          </EdgeText>
          <ExchangeRate2 wallet={wallet} tokenId={tokenId} />
        </View>
      )
    }

    const renderBalance = () => {
      const { multiplier, name } = displayDenom
      const balanceCrypto = balanceMap.get(tokenId) ?? '0'
      const balance = `${formatNumber(
        div(balanceCrypto, multiplier, DECIMAL_PRECISION)
      )} ${name} (`
      const parenString = ')'
      return (
        <View style={styles.rateBalanceContainer}>
          <EdgeText style={styles.secondaryTitle}>
            {lstrings.send_confirmation_balance}
          </EdgeText>
          <EdgeText style={styles.rateBalanceText}>
            {balance}
            <FiatText
              currencyConfig={wallet.currencyConfig}
              tokenId={tokenId}
              nativeCryptoAmount={balanceCrypto}
            />
            {parenString}
          </EdgeText>
        </View>
      )
    }

    const renderFees = () => {
      const feeDisplayAmountTemp = div(
        feeNativeAmount,
        feeDisplayDenom.multiplier,
        DECIMAL_PRECISION
      )
      const feeDisplayAmount = toFixed(
        feeDisplayAmountTemp,
        0,
        log10(feeDisplayDenom.multiplier)
      )

      const feeCryptoText = `${feeDisplayAmount} ${feeDisplayDenom.name} (`
      const feeTextStyle =
        feeStyle === 'dangerText'
          ? styles.feeTextDanger
          : feeStyle === 'warningText'
          ? styles.feeTextWarning
          : styles.feeTextDefault
      const parenString = ')'
      return (
        <View style={styles.feeContainer}>
          <View style={styles.feeTitleContainer}>
            <EdgeText style={styles.primaryTitle}>
              {lstrings.string_fee}
            </EdgeText>
            {onFeesChange ? (
              <FontAwesomeIcon
                name="edit"
                style={styles.feeIcon}
                size={theme.rem(0.75)}
              />
            ) : null}
          </View>
          <EdgeText style={feeTextStyle}>
            {feeCryptoText}
            <FiatText
              nativeCryptoAmount={feeNativeAmount}
              currencyConfig={wallet.currencyConfig}
              maxPrecision={2}
              subCentTruncation
              tokenId={feeTokenId}
            />
            {parenString}
          </EdgeText>
        </View>
      )
    }

    const renderFlipInput = () => {
      return (
        <EdgeCard marginRem={[0, 0.5, 0.5]}>
          <ExchangedFlipInput2
            forceField={amounts.fieldChanged}
            headerText={flipInputHeaderText}
            hideMaxButton={hideMaxButton}
            keyboardVisible
            ref={exchangedFlipInputRef}
            startNativeAmount={startNativeAmount}
            tokenId={tokenId}
            wallet={wallet}
            onAmountChanged={handleAmountsChanged}
            onMaxPress={handleSendMaxAmount}
            onNext={handleCloseModal}
          />
        </EdgeCard>
      )
    }

    React.useImperativeHandle(ref, () => ({
      setFees: (params: SetFeesParams) => {
        setFeeTokenId(params.feeTokenId)
        setFeeNativeAmount(params.feeNativeAmount)
      },
      setAmount: (field: ExchangeFlipInputFields, value: string) =>
        exchangedFlipInputRef.current?.setAmount(field, value),
      setError: (errorMessage: string | null) => setErrorMessage(errorMessage)
    }))

    return (
      <EdgeModal bridge={bridge} onCancel={handleCloseModal}>
        <View style={styles.flipInput}>{renderFlipInput()}</View>
        <EdgeTouchableWithoutFeedback onPress={handleFeesChange}>
          <View style={styles.fees}>
            {renderFees()}
            {renderExchangeRates()}
            {renderBalance()}
            {renderErrorMessage()}
          </View>
        </EdgeTouchableWithoutFeedback>
        <ReturnKeyTypeButton returnKeyType="done" onPress={handleCloseModal} />
      </EdgeModal>
    )
  }
)

const getStyles = cacheStyles((theme: Theme) => ({
  flipInput: {
    justifyContent: 'flex-start'
  },
  fees: {
    justifyContent: 'flex-end',
    margin: theme.rem(0.5)
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerMaxAmountText: {
    color: theme.textLink
  },
  primaryTitle: {
    color: theme.secondaryText
  },
  secondaryTitle: {
    flex: 1,
    fontSize: theme.rem(0.75),
    color: theme.secondaryText
  },
  rateBalanceContainer: {
    flexDirection: 'row'
  },
  exchangeRateErrorText: {
    fontSize: theme.rem(0.75),
    color: theme.dangerText
  },
  rateBalanceText: {
    fontSize: theme.rem(0.75)
  },
  feeContainer: {
    flexDirection: 'row',
    marginTop: theme.rem(0.5),
    marginBottom: theme.rem(1)
  },
  feeTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
  },
  feeTextDefault: {
    color: theme.primaryText
  },
  feeTextWarning: {
    color: theme.warningText
  },
  feeTextDanger: {
    color: theme.dangerText
  },
  feeIcon: {
    color: theme.iconTappable,
    marginLeft: theme.rem(0.5)
  }
}))

export const FlipInputModal2 = memo(FlipInputModal2Component)
