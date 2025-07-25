import { describe, expect, it } from '@jest/globals'
import { render } from '@testing-library/react-native'
import * as React from 'react'

import { SwapSuccessScene } from '../../components/scenes/SwapSuccessScene'
import { btcCurrencyInfo } from '../../util/fake/fakeBtcInfo'
import { makeFakeCurrencyConfig } from '../../util/fake/fakeCurrencyConfig'
import { FakeProviders, FakeState } from '../../util/fake/FakeProviders'
import { fakeEdgeAppSceneProps } from '../../util/fake/fakeSceneProps'

const fakeCurrencyConfig = makeFakeCurrencyConfig(btcCurrencyInfo)

const fakeCoreWallet: any = {
  balanceMap: new Map([[null, '123123']]),
  blockHeight: 12345,
  currencyConfig: fakeCurrencyConfig,
  currencyInfo: fakeCurrencyConfig.currencyInfo,
  enabledTokenIds: [],
  fiatCurrencyCode: 'iso:USD',
  id: '123',
  name: 'wallet name',
  type: 'wallet:bitcoin',
  watch() {}
}

describe('SwapSuccessSceneComponent', () => {
  it('should render with loading props', () => {
    const fakeState: FakeState = {
      core: {
        account: {
          id: '',
          currencyWallets: { '123': fakeCoreWallet },
          currencyConfig: { bitcoin: fakeCurrencyConfig },
          watch() {}
        }
      }
    }

    const rendered = render(
      <FakeProviders initialState={fakeState}>
        <SwapSuccessScene
          {...fakeEdgeAppSceneProps('swapSuccess', {
            walletId: fakeCoreWallet.id,
            edgeTransaction: {
              blockHeight: 0,
              currencyCode: 'BTC',
              date: 1535752780.947, // 2018-08-31T21:59:40.947Z
              isSend: false,
              memos: [],
              metadata: { name: 'timmy' },
              nativeAmount: '12300000',
              networkFee: '1',
              networkFees: [],
              otherParams: {},
              ourReceiveAddresses: ['this is an address'],
              signedTx: 'this is a signed tx',
              tokenId: null,
              txid: 'this is the txid',
              walletId: fakeCoreWallet.id
            }
          })}
        />
      </FakeProviders>
    )

    expect(rendered.toJSON()).toMatchSnapshot()
    rendered.unmount()
  })
})
