import { describe, expect, it } from '@jest/globals'
import { render } from '@testing-library/react-native'
import * as React from 'react'

import { TransactionDetailsScene } from '../../components/scenes/TransactionDetailsScene'
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

describe('TransactionDetailsScene', () => {
  const fakeState: FakeState = {
    core: {
      account: {
        currencyWallets: { '123': fakeCoreWallet },
        currencyConfig: { bitcoin: fakeCurrencyConfig },
        watch() {}
      }
    },
    contacts: [
      {
        givenName: 'Timmy',
        thumbnailPath: 'thumb/nail/path'
      }
    ],
    exchangeRates: {
      'BTC_iso:USD': 10000,
      'BTC_iso:USD_2018-08-31T21:59:40.947Z': 20000
    }
  }

  it('should render', () => {
    const rendered = render(
      <FakeProviders initialState={fakeState}>
        <TransactionDetailsScene
          {...fakeEdgeAppSceneProps('transactionDetails', {
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
            },
            walletId: fakeCoreWallet.id
          })}
        />
      </FakeProviders>
    )

    expect(rendered.toJSON()).toMatchSnapshot()
    rendered.unmount()
  })

  it('should render with negative nativeAmount and fiatAmount', () => {
    const rendered = render(
      <FakeProviders initialState={fakeState}>
        <TransactionDetailsScene
          {...fakeEdgeAppSceneProps('transactionDetails', {
            edgeTransaction: {
              blockHeight: 0,
              currencyCode: 'BTC',
              date: 1535752780.947, // 2018-08-31T21:59:40.947Z
              isSend: true,
              memos: [],
              metadata: {
                exchangeAmount: { 'iso:USD': -6392.93 },
                name: 'timmy'
              },
              nativeAmount: '-12300000',
              networkFee: '1',
              networkFees: [],
              otherParams: {},
              ourReceiveAddresses: ['this is an address'],
              signedTx: 'this is a signed tx',
              tokenId: null,
              txid: 'this is the txid',
              walletId: fakeCoreWallet.id
            },
            walletId: fakeCoreWallet.id
          })}
        />
      </FakeProviders>
    )

    expect(rendered.toJSON()).toMatchSnapshot()
    rendered.unmount()
  })
})
