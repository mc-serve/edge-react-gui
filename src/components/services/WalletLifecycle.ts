import { EdgeAccount, EdgeContext, EdgeCurrencyWallet } from 'edge-core-js'
import * as React from 'react'
import { Platform } from 'react-native'

import { connect } from '../../types/reactRedux'
import { WalletListItem } from '../../types/types'
import { isKeysOnlyPlugin } from '../../util/CurrencyInfoHelpers'
import { showError } from './AirshipInstance'

interface StateProps {
  account: EdgeAccount
  context: EdgeContext
  sortedWalletList: WalletListItem[]
  userPausedWalletsSet: Set<string> | null
}
type Props = StateProps

/**
 * Tracks the state of a booting wallet.
 */
interface WalletBoot {
  close: () => void
  complete: boolean
  walletId: string
}

const BOOT_LIMIT = Platform.OS === 'ios' ? 8 : 3

/**
 * Responsible for pausing & un-pausing wallets.
 */
export class WalletLifecycleComponent extends React.Component<Props> {
  // Core & related subscriptions:
  edgeAccount: EdgeAccount | undefined
  edgeContext: EdgeContext | undefined
  cleanups: Array<() => void> = []

  // Wallet booting state:
  booting: WalletBoot[] = []
  paused: boolean = false

  /**
   * Forgets about any booting wallets.
   */
  cancelBoot() {
    for (const boot of this.booting) boot.close()
    this.booting = []
  }

  /**
   * Unsubscribes from the account & context callbacks.
   */
  unsubscribe() {
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
  }

  /**
   * Figures out what has changed and adapts.
   */
  handleChange = () => {
    const { account, context, sortedWalletList, userPausedWalletsSet } =
      this.props

    // Check for login / logout:
    if (account !== this.edgeAccount || context !== this.edgeContext) {
      this.cancelBoot()
      this.unsubscribe()

      // Only subscribe if we are logged in:
      if (
        typeof account.watch === 'function' &&
        typeof context.watch === 'function'
      ) {
        this.cleanups = [
          account.watch('activeWalletIds', this.handleChange),
          account.watch('currencyWallets', this.handleChange),
          context.watch('paused', this.handleChange)
        ]
      }
    }
    this.edgeAccount = account
    this.edgeContext = context

    // Grab the mutable core state:
    const { paused } = context
    const { currencyWallets } = account
    // If we have become paused (app into background), shut down all wallets:
    if (paused && !this.paused) {
      this.cancelBoot()
      Promise.all(
        Object.keys(currencyWallets).map(
          async walletId => await currencyWallets[walletId].changePaused(true)
        )
      ).catch(error => showError(error))
    }
    this.paused = paused

    // The next steps only apply if we are active:
    if (paused || userPausedWalletsSet == null) return

    // Check for boots that have completed, and for deleted wallets:
    this.booting = this.booting.filter(boot => {
      const { complete, walletId } = boot
      if (complete) return false

      const wallet = currencyWallets[walletId]
      if (wallet == null) {
        boot.close()
        return false
      }

      return true
    })

    // Use the sortedWalletList to boot the wallets in the same order they appear in the list
    for (const walletItem of sortedWalletList) {
      if (this.booting.length >= BOOT_LIMIT) break

      // Ignore missing wallets, token rows, started wallets, already-booting
      // wallets, keysOnlyMode, and user-paused wallets:
      if (walletItem.type !== 'asset') continue
      const { token, tokenId, wallet } = walletItem
      if (token != null || tokenId != null) continue
      if (isKeysOnlyPlugin(wallet.currencyInfo.pluginId)) continue
      if (!wallet.paused) continue
      if (this.booting.find(boot => boot.walletId === wallet.id) != null)
        continue
      if (userPausedWalletsSet.has(wallet.id)) continue

      this.booting.push(bootWallet(wallet, this.handleChange))
    }
  }

  componentDidMount() {
    this.handleChange()
  }

  componentDidUpdate() {
    this.handleChange()
  }

  componentWillUnmount() {
    this.cancelBoot()
    this.unsubscribe()
  }

  render() {
    return null
  }
}

/**
 * Un-pause a wallet, and then call the callback once the wallet syncs.
 * Returns an object that can be used to monitor the status
 * or cancel the callback.
 */
function bootWallet(
  wallet: EdgeCurrencyWallet,
  onBoot: () => void
): WalletBoot {
  let cleanup: (() => void) | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const out: WalletBoot = {
    close() {
      if (out.complete) return
      if (timeoutId != null) clearTimeout(timeoutId)
      if (cleanup != null) cleanup()
      out.complete = true
    },
    complete: false,
    walletId: wallet.id
  }

  // Start the wallet, then wait for it to sync or time out:
  wallet
    .changePaused(false)
    .then(() => {
      // Check the already-closed and already-synced cases:
      if (out.complete) return
      if (wallet.syncRatio >= 1) {
        onBoot()
        out.close()
        return
      }

      cleanup = wallet.watch('syncRatio', ratio => {
        if (ratio < 1) return
        if (!out.complete) onBoot()
        out.close()
      })

      timeoutId = setTimeout(() => {
        timeoutId = undefined
        if (!out.complete) onBoot()
        out.close()
      }, 5000)
    })
    .catch(error => showError(error))

  return out
}

export const WalletLifecycle = connect<StateProps, {}, {}>(
  state => ({
    account: state.core.account,
    context: state.core.context,
    sortedWalletList: state.sortedWalletList,
    userPausedWalletsSet: state.ui.settings.userPausedWalletsSet
  }),
  dispatch => ({})
)(WalletLifecycleComponent)
