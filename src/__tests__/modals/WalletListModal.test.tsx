import { describe, expect, it } from '@jest/globals'
import { render } from '@testing-library/react-native'
import * as React from 'react'

import { WalletListModal } from '../../components/modals/WalletListModal'
import { EdgeAsset } from '../../types/types'
import { fakeAirshipBridge } from '../../util/fake/fakeAirshipBridge'
import { FakeProviders } from '../../util/fake/FakeProviders'
import { fakeNavigation } from '../../util/fake/fakeSceneProps'
import { upgradeCurrencyCodes } from '../../util/tokenIdTools'

describe('WalletListModal', () => {
  it('should render with loading props', () => {
    const rendered = render(
      <FakeProviders>
        <WalletListModal
          bridge={fakeAirshipBridge}
          navigation={fakeNavigation}
          headerTitle="Wallet List"
        />
      </FakeProviders>
    )

    expect(rendered.toJSON()).toMatchSnapshot()
    rendered.unmount()
  })

  it("Should upgrade currency codes to token ID's", () => {
    const data: { [code: string]: EdgeAsset[] } = {
      ETH: [{ pluginId: 'ethereum', tokenId: null }],
      BNB: [
        { pluginId: 'binance', tokenId: null },
        { pluginId: 'ethereum', tokenId: '1234abcd' }
      ]
    }
    function lookup(currencyCode: string): EdgeAsset[] {
      return data[currencyCode.toUpperCase()] ?? []
    }

    // Check ambiguous currency codes:
    expect(upgradeCurrencyCodes(lookup, ['ETH', 'BNB'])).toEqual([
      { pluginId: 'ethereum', tokenId: null },
      { pluginId: 'binance', tokenId: null },
      { pluginId: 'ethereum', tokenId: '1234abcd' }
    ])

    // Check scoped currency codes:
    expect(upgradeCurrencyCodes(lookup, ['ETH', 'ETH-BNB'])).toEqual([
      { pluginId: 'ethereum', tokenId: null },
      { pluginId: 'ethereum', tokenId: '1234abcd' }
    ])

    // Check missing currency codes:
    expect(upgradeCurrencyCodes(lookup, ['ETH', 'LOL'])).toEqual([
      { pluginId: 'ethereum', tokenId: null }
    ])
  })
})
