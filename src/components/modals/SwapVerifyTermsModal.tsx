import { EdgeSwapConfig, EdgeSwapInfo } from 'edge-core-js/types'
import * as React from 'react'
import { Linking, Text, View } from 'react-native'
import { AirshipBridge } from 'react-native-airship'
import FastImage from 'react-native-fast-image'

import { lstrings } from '../../locales/strings'
import { getSwapPluginIconUri } from '../../util/CdnUris'
import { Airship } from '../services/AirshipInstance'
import { cacheStyles, Theme, useTheme } from '../services/ThemeContext'
import { Paragraph } from '../themed/EdgeText'
import { MainButton } from '../themed/MainButton'
import { ModalTitle } from '../themed/ModalParts'
import { EdgeModal } from './EdgeModal'

interface TermsUri {
  termsUri?: string
  privacyUri?: string
  kycUri?: string
}

const pluginData: { [pluginId: string]: TermsUri } = {
  changehero: {
    termsUri: 'https://changehero.io/terms-of-use',
    privacyUri: 'https://changehero.io/privacy-policy',
    kycUri: 'https://changehero.io/aml-kyc'
  },
  changenow: {
    termsUri: 'https://changenow.io/terms-of-use',
    privacyUri: 'https://changenow.io/privacy-policy',
    kycUri: 'https://changenow.io/faq/kyc'
  },
  exolix: {
    termsUri: 'https://exolix.com/terms',
    privacyUri: 'https://exolix.com/privacy',
    kycUri: 'https://exolix.com/aml-kyc'
  },
  sideshift: {
    termsUri: 'https://sideshift.ai/legal',
    kycUri:
      'https://help.sideshift.ai/en/articles/6230858-sideshift-ai-s-risk-management-policy'
  },
  swapuz: {
    termsUri: 'https://swapuz.com/terms-of-use',
    privacyUri: 'https://swapuz.com/privacy-policy',
    kycUri: 'https://swapuz.com/terms-of-use#amlProcedure'
  }
}

export async function swapVerifyTerms(
  swapConfig: EdgeSwapConfig
): Promise<boolean> {
  const { pluginId } = swapConfig.swapInfo
  const uris = pluginData[pluginId]
  if (uris == null) return true
  if (swapConfig.userSettings && swapConfig.userSettings.agreedToTerms) {
    return true
  }

  const result = await Airship.show<boolean>(bridge => (
    <SwapVerifyTermsModal
      bridge={bridge}
      swapInfo={swapConfig.swapInfo}
      uris={uris}
    />
  ))

  if (result) {
    await swapConfig.changeUserSettings({ agreedToTerms: true })
  } else {
    await swapConfig.changeUserSettings({ agreedToTerms: false })
    await swapConfig.changeEnabled(false)
  }
  return result
}

interface Props {
  bridge: AirshipBridge<boolean>
  swapInfo: EdgeSwapInfo
  uris: TermsUri
}

function SwapVerifyTermsModal(props: Props) {
  const { bridge, swapInfo, uris } = props
  const { displayName, pluginId } = swapInfo
  const { termsUri, privacyUri, kycUri } = uris
  const theme = useTheme()
  const styles = getStyles(theme)

  return (
    <EdgeModal
      bridge={bridge}
      title={
        <View style={styles.titleContainer}>
          <FastImage
            style={styles.titleImage}
            source={{ uri: getSwapPluginIconUri(pluginId, theme) }}
            resizeMode="contain"
          />
          <ModalTitle>{displayName}</ModalTitle>
        </View>
      }
      onCancel={() => bridge.resolve(false)}
    >
      <Paragraph>{lstrings.swap_terms_statement}</Paragraph>
      <MainButton
        label={lstrings.swap_terms_accept_button}
        marginRem={1}
        onPress={() => bridge.resolve(true)}
      />
      <MainButton
        label={lstrings.swap_terms_reject_button}
        marginRem={1}
        type="secondary"
        onPress={() => bridge.resolve(false)}
      />
      <View style={styles.linkContainer}>
        {termsUri == null ? null : (
          <Text
            style={styles.linkText}
            onPress={async () => await Linking.openURL(termsUri)}
          >
            {lstrings.swap_terms_terms_link}
          </Text>
        )}
        {privacyUri == null ? null : (
          <Text
            style={styles.linkText}
            onPress={async () => await Linking.openURL(privacyUri)}
          >
            {lstrings.swap_terms_privacy_link}
          </Text>
        )}
        {kycUri == null ? null : (
          <Text
            style={styles.linkText}
            onPress={async () => await Linking.openURL(kycUri)}
          >
            {lstrings.swap_terms_kyc_link}
          </Text>
        )}
      </View>
    </EdgeModal>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  linkText: {
    color: theme.iconTappable,
    flexShrink: 1,
    fontFamily: theme.fontFaceDefault,
    fontSize: theme.rem(0.84),
    margin: theme.rem(0.5)
  },
  titleContainer: {
    alignItems: 'center',
    flexDirection: 'row'
  },
  titleImage: {
    height: theme.rem(1.75),
    margin: theme.rem(0.5),
    width: theme.rem(1.75)
  }
}))
