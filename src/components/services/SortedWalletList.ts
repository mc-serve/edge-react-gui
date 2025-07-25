import { EdgeAccount } from 'edge-core-js'
import * as React from 'react'

import { useAllTokens } from '../../hooks/useAllTokens'
import { useWalletsSubscriber } from '../../hooks/useWalletsSubscriber'
import { useWatch } from '../../hooks/useWatch'
import { useDispatch, useSelector } from '../../types/reactRedux'
import {
  GuiExchangeRates,
  WalletListAssetItem,
  WalletListItem
} from '../../types/types'
import { getWalletTokenId } from '../../util/CurrencyInfoHelpers'
import { getWalletName } from '../../util/CurrencyWalletHelpers'
import { normalizeForSearch } from '../../util/utils'

interface Props {
  account: EdgeAccount
}

interface EnabledTokenIds {
  [walletId: string]: string[]
}

/**
 * Manages the master wallet list, which includes all
 * wallets and the tokens in the account,
 * sorted according to the user's preference.
 *
 * The wallet list scene and modal can apply their own filtering,
 * and the modal can add extra rows for creating wallets.
 *
 * We are subscribed to a *tremendous* number of things here.
 * This is really expensive, so we restore performance by
 * structuring this component like a giant `useMemo` hook.
 * Even if our inputs change frequently, we only update redux
 * when the final sort order actually changes in some way.
 *
 * We still have to pay the price of rendering this one component,
 * so we make that as fast as possible by using good data structures
 * and tight code.
 */
export function SortedWalletList(props: Props) {
  const { account } = props

  // Subscribe to everything that affects the list ordering:
  const allTokens = useAllTokens(account)
  const activeWalletIds = useWatch(account, 'activeWalletIds')
  const currencyWallets = useWatch(account, 'currencyWallets')
  const enabledTokenIds = useEnabledWalletIds(account)
  const exchangeRates = useSelector(state => state.exchangeRates)
  const defaultIsoFiat = useSelector(state => state.ui.settings.defaultIsoFiat)
  const walletsSort = useSelector(state => state.ui.settings.walletsSort)

  // Phase 1: Gather the active wallets and tokens.
  const wallets: WalletListItem[] = []
  for (const walletId of activeWalletIds) {
    const wallet = currencyWallets[walletId]

    // Add the wallet itself:
    if (wallet == null) {
      wallets.push({
        type: 'loading',
        key: `${walletId}-loading`,
        walletId
      })
    } else {
      wallets.push({
        type: 'asset',
        key: walletId,
        tokenId: null,
        wallet
      })
    }

    // Add the tokens:
    if (wallet == null) continue
    for (const tokenId of enabledTokenIds[walletId] ?? []) {
      const { pluginId } = wallet.currencyInfo
      const token = allTokens[pluginId][tokenId]
      if (token == null) continue
      wallets.push({
        type: 'asset',
        key: `${walletId} ${tokenId}`,
        token,
        tokenId,
        wallet
      })
    }
  }

  // Phase 2: Sort the list.
  let sorted = wallets
  switch (walletsSort) {
    case 'currencyCode':
      sorted = stableSort(
        wallets,
        alphabeticalSort(({ token, wallet }) => {
          if (token != null) return token.currencyCode
          return wallet.currencyInfo.currencyCode
        })
      )
      break

    case 'currencyName':
      sorted = stableSort(
        wallets,
        alphabeticalSort(({ token, wallet }) => {
          if (token != null) return token.displayName
          return wallet.currencyInfo.displayName
        })
      )
      break

    case 'highest':
      sorted = stableSort(
        wallets,
        numericSort(item => -getFiat(item, defaultIsoFiat, exchangeRates))
      )
      break

    case 'lowest':
      sorted = stableSort(
        wallets,
        numericSort(item => getFiat(item, defaultIsoFiat, exchangeRates))
      )
      break

    case 'manual':
      break

    case 'name':
      sorted = stableSort(
        wallets,
        alphabeticalSort(item => getWalletName(item.wallet))
      )
      break
  }

  // Phase 3: Check for differences.
  const dispatch = useDispatch()
  const lastList = React.useRef<WalletListItem[] | undefined>(undefined)
  React.useEffect(() => {
    if (
      lastList.current == null ||
      !matchWalletList(sorted, lastList.current)
    ) {
      dispatch({ type: 'UPDATE_SORTED_WALLET_LIST', data: sorted })
    }
    lastList.current = sorted
  })

  return null
}

/**
 * Subscribes to all the enabled token lists in the account.
 */
function useEnabledWalletIds(account: EdgeAccount): EnabledTokenIds {
  const [out, setOut] = React.useState<EnabledTokenIds>(() => {
    const out: EnabledTokenIds = {}
    for (const walletId of account.activeWalletIds) {
      const wallet = account.currencyWallets[walletId]
      out[walletId] = wallet == null ? [] : wallet.enabledTokenIds
    }
    return out
  })

  useWalletsSubscriber(account, wallet => {
    setOut(out => ({ ...out, [wallet.id]: wallet.enabledTokenIds }))
    return wallet.watch('enabledTokenIds', enabledTokenIds => {
      setOut(out => ({ ...out, [wallet.id]: enabledTokenIds }))
    })
  })

  return out
}

/**
 * Creates a sort function that compares strings,
 * putting `undefined` items at the end.
 */
const alphabeticalSort =
  (getText: (item: WalletListAssetItem) => string) =>
  (a: WalletListItem, b: WalletListItem): number => {
    const textA = a.type === 'asset' ? getText(a) : undefined
    const textB = b.type === 'asset' ? getText(b) : undefined
    if (textA != null && textB != null) return textA.localeCompare(textB)
    if (textA == null) return 1
    if (textB == null) return -1
    return 0
  }

/**
 * Creates a sort function that compares fiat values,
 * putting `undefined` values at the end.
 */
const numericSort =
  (getNumber: (item: WalletListAssetItem) => number) =>
  (a: WalletListItem, b: WalletListItem): number => {
    const numberA = a.type === 'asset' ? getNumber(a) : undefined
    const numberB = b.type === 'asset' ? getNumber(b) : undefined
    if (numberA != null && numberB != null) return numberA - numberB
    if (numberA == null) return 1
    if (numberB == null) return -1
    return 0
  }

/**
 * Returns a sorted copy of an array.
 * Hermes does not have a stable sorting algorithm,
 * so the default `sort` output is semi-random.
 * This works around that problem.
 */
function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const out = compare(a.item, b.item)
      return out === 0 ? a.index - b.index : out
    })
    .map(({ item }) => item)
}

/**
 * Calculate the fiat balance for a wallet.
 * This uses floating-point math for speed,
 * since rates are approximate and big math is super-expensive.
 */
function getFiat(
  item: WalletListAssetItem,
  isoFiatCurrencyCode: string,
  exchangeRates: GuiExchangeRates
): number {
  const { token, wallet } = item

  // The core does not yet report balances by tokenId, just by currencyCode:
  const {
    currencyCode,
    denominations: [denomination]
  } = token != null ? token : wallet.currencyInfo
  const tokenId = getWalletTokenId(wallet, currencyCode)
  const nativeBalance = wallet.balanceMap.get(tokenId) ?? '0'

  // Find the rate:
  const rate = exchangeRates[`${currencyCode}_${isoFiatCurrencyCode}`] ?? '0'

  // Do the conversion:
  return (
    rate * (parseFloat(nativeBalance) / parseFloat(denomination.multiplier))
  )
}

/**
 * Returns true if two wallet lists match.
 * We use the item key as a shortcut.
 */
function matchWalletList(a: WalletListItem[], b: WalletListItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; ++i) {
    if (a[i].key !== b[i].key) return false
  }
  return true
}

/**
 * Filters a wallet list using a search string.
 */
export function searchWalletList(
  list: WalletListItem[],
  searchText: string
): WalletListItem[] {
  if (searchText === '') return list

  const target = normalizeForSearch(searchText)
  return list.filter(item => {
    // Eliminate loading wallets in search mode:
    if (item.type !== 'asset') return false
    const { token, wallet } = item

    // Grab wallet and token information:
    const { currencyCode, displayName } =
      token == null ? wallet.currencyInfo : token
    const name = getWalletName(wallet)

    const contractAddress = token?.networkLocation?.contractAddress ?? ''

    return (
      normalizeForSearch(currencyCode).includes(target) ||
      normalizeForSearch(displayName).includes(target) ||
      normalizeForSearch(name).includes(target) ||
      normalizeForSearch(contractAddress).includes(target)
    )
  })
}
