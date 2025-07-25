import { describe, expect, test } from '@jest/globals'
import { sprintf } from 'sprintf-js'

import { lstrings } from '../locales/strings'
import { createPriorityArray } from '../plugins/gui/amountQuotePlugin'
import { FiatProviderQuoteError } from '../plugins/gui/fiatProviderTypes'
import { getBestError } from '../plugins/gui/pluginUtils'

const FAKE_CODE = 'FAKE'

describe('creditCardPlugin', function () {
  describe('createPriorityArray', function () {
    test('createPriorityArray', function () {
      const prio = {
        pro1: 20,
        pro2: 10,
        pro3: 10,
        pro4: 15,
        pro5: 16,
        pro6: 15
      }
      const result = createPriorityArray(prio)
      console.error(result)
      expect(JSON.stringify(result)).toBe(
        JSON.stringify([
          { pro1: true },
          { pro5: true },
          { pro4: true, pro6: true },
          { pro2: true, pro3: true }
        ])
      )
    })
  })
  describe('getBestError', function () {
    test('overLimit', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'overLimit',
          errorAmount: 50
        }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_amount_over_limit, '50 USD')
      )
    })
    test('underLimit', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'underLimit',
          errorAmount: 50
        }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_amount_under_limit, '50 USD')
      )
    })
    test('regionRestricted', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'regionRestricted',
          displayCurrencyCode: FAKE_CODE
        }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_region_restricted, FAKE_CODE)
      )
    })
    test('assetUnsupported', function () {
      const errors: FiatProviderQuoteError[] = [
        { providerId: '', errorType: 'assetUnsupported' }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(lstrings.fiat_plugin_asset_unsupported)
    })
    test('underLimit 1 2 3', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'underLimit',
          errorAmount: 1
        },
        {
          providerId: '',
          errorType: 'underLimit',
          errorAmount: 2
        },
        {
          providerId: '',
          errorType: 'underLimit',
          errorAmount: 3
        }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_amount_under_limit, '1 USD')
      )
    })
    test('overLimit 1 2 3', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'overLimit',
          errorAmount: 1
        },
        {
          providerId: '',
          errorType: 'overLimit',
          errorAmount: 2
        },
        {
          providerId: '',
          errorType: 'overLimit',
          errorAmount: 3
        }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_amount_over_limit, '3 USD')
      )
    })
    test('overLimit underLimit regionRestricted assetUnsupported', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'overLimit',
          errorAmount: 1
        },
        {
          providerId: '',
          errorType: 'underLimit',
          errorAmount: 2
        },
        {
          providerId: '',
          errorType: 'regionRestricted',
          displayCurrencyCode: FAKE_CODE
        },
        { providerId: '', errorType: 'assetUnsupported' }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_amount_under_limit, '2 USD')
      )
    })
    test('regionRestricted assetUnsupported', function () {
      const errors: FiatProviderQuoteError[] = [
        {
          providerId: '',
          errorType: 'regionRestricted',
          displayCurrencyCode: FAKE_CODE
        },
        { providerId: '', errorType: 'assetUnsupported' }
      ]
      const { errorText } = getBestError(errors, 'USD', 'buy')
      expect(errorText).toBe(
        sprintf(lstrings.fiat_plugin_buy_region_restricted, FAKE_CODE)
      )
    })
  })
})
