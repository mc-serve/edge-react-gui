import { div } from 'biggystring'
import { asMaybe, asNumber, asObject, asString } from 'cleaners'
import { Disklet } from 'disklet'
import {
  EdgeAccount,
  EdgeCurrencyConfig,
  EdgeCurrencyWallet,
  EdgeDenomination,
  EdgeSpendInfo,
  EdgeTransaction
} from 'edge-core-js'
import { sprintf } from 'sprintf-js'

import { PAYMENT_PROTOCOL_MAP } from '../actions/PaymentProtoActions'
import { FIO_STR } from '../constants/WalletAndCurrencyConstants'
import { ENV } from '../env'
import { lstrings } from '../locales/strings'
import { CcWalletMap } from '../reducers/FioReducer'
import {
  EdgeAsset,
  FioAddress,
  FioDomain,
  FioObtRecord,
  StringMap
} from '../types/types'
import { asIntegerString } from './cleaners/asIntegerString'
import { DECIMAL_PRECISION, truncateDecimals } from './utils'

const CONNECTED_WALLETS = 'ConnectedWallets.json'
const FIO_ADDRESS_CACHE = 'FioAddressCache.json'
const FIO_EXPIRED_CHECK = 'FioExpiredCheck.json'
const MONTH = 1000 * 60 * 60 * 24 * 30
const DEFAULT_BUNDLE_SET_VALUE = 1

export const BUNDLED_TXS_AMOUNT_ALERT = 5

// These should match the methods in edge-currency-accountbased:
interface FioMakeSpendParams {
  addBundledTransactions: {
    fioAddress: string
    bundleSets: number
  }

  addPublicAddresses: {
    fioAddress: string
    publicAddresses: Array<{
      token_code: string
      chain_code: string
      public_address: string
    }>
  }

  cancelFundsRequest: {
    fioAddress: string
    fioRequestId: number
  }

  recordObtData: {
    payeeFioAddress: string
    payeePublicAddress: string
    payerFioAddress: string
    payerPublicAddress: string
    amount: string
    memo: string
    chainCode: string
    tokenCode: string
    obtId: string

    fioRequestId?: number
    status?: 'cancelled' | 'rejected' | 'requested' | 'sent_to_blockchain'
  }

  registerFioAddress: {
    fioAddress: string
  }

  registerFioDomain: {
    fioDomain: string
  }

  rejectFundsRequest: {
    payerFioAddress: string
    fioRequestId: number
  }

  removePublicAddresses: {
    fioAddress: string
    publicAddresses: Array<{
      token_code: string
      chain_code: string
      public_address: string
    }>
  }

  renewFioDomain: {
    fioDomain: string
  }

  requestFunds: {
    payeeFioAddress: string
    payeeTokenPublicAddress: string
    payerFioAddress: string
    payerFioPublicKey: string
    amount: string
    chainCode: string
    tokenCode: string
    memo: string
  }

  setFioDomainVisibility: {
    fioDomain: string
    isPublic: boolean
  }

  transferFioAddress: {
    fioAddress: string
  }

  transferFioDomain: {
    fioDomain: string
  }
}

export interface FioConnectAddress {
  walletId: string
  fioChainCode: string
  fioTokenCode: string
  publicAddress: string
}

interface DiskletConnectedWallets {
  [fullCurrencyCode: string]: {
    walletId: string
    publicAddress: string
  }
}

export interface FioAddresses {
  addresses: {
    [address: string]: boolean
  }
}

export const FIO_NO_BUNDLED_ERR_CODE = 'FIO_NO_BUNDLED_ERR_CODE'
export const FIO_FEE_EXCEEDS_SUPPLIED_MAXIMUM = 'Fee exceeds supplied maximum'
export const FIO_DOMAIN_IS_NOT_PUBLIC = 'FIO_DOMAIN_IS_NOT_PUBLIC'
export const FIO_FAKE_RECORD_OBT_DATA_REQUEST = {
  payerFioAddress: '',
  payeeFioAddress: '',
  payerPublicAddress: '',
  payeePublicAddress: '',
  amount: '',
  tokenCode: '',
  chainCode: '',
  obtId: '',
  memo: '',
  status: 'sent_to_blockchain' as const
}
export class FioError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.code = code
    this.name = 'FioError'
  }
}
/**
 * Get connected wallets from disklet
 *
 * @param fioWallet
 * @returns {Promise<*>}
 */
const getConnectedWalletsFromFile = async (
  fioWallet: EdgeCurrencyWallet
): Promise<{ [fioAddress: string]: DiskletConnectedWallets }> => {
  try {
    const savedConnectedWalletsText = await fioWallet.disklet.getText(
      CONNECTED_WALLETS
    )
    return JSON.parse(savedConnectedWalletsText)
  } catch (e: any) {
    return {}
  }
}

/**
 * Get connected wallets for FIO Address from disklet
 *
 * @param fioWallet
 * @param fioAddress
 * @returns {Promise<*>}
 */
const getConnectedWalletsForFioAddress = async (
  fioWallet: EdgeCurrencyWallet,
  fioAddress: string
): Promise<DiskletConnectedWallets> => {
  const savedConnectedWallets = await getConnectedWalletsFromFile(fioWallet)
  return savedConnectedWallets[fioAddress] || {}
}

/**
 * Set connected wallets to disklet
 *
 * @param fioWallet
 * @param fioAddress
 * @param connectedWallets
 * @returns {Promise<void>}
 */
const setConnectedWalletsFromFile = async (
  fioWallet: EdgeCurrencyWallet,
  fioAddress: string,
  connectedWallets: DiskletConnectedWallets
): Promise<void> => {
  try {
    const savedConnectedWallets = await getConnectedWalletsFromFile(fioWallet)
    savedConnectedWallets[fioAddress] = connectedWallets
    await fioWallet.disklet.setText(
      CONNECTED_WALLETS,
      JSON.stringify(savedConnectedWallets)
    )
  } catch (e: any) {
    console.log('setConnectedWalletsFromFile error - ', e)
  }
}

export const getFioExpiredCheckFromDisklet = async (
  disklet: Disklet
): Promise<{ [fioName: string]: Date }> => {
  try {
    const lastChecks = JSON.parse(await disklet.getText(FIO_EXPIRED_CHECK))
    return Object.keys(lastChecks).reduce(
      (checkDates, fioName) => ({
        ...checkDates,
        [fioName]: new Date(lastChecks[fioName])
      }),
      {}
    )
  } catch (error: any) {
    return {}
  }
}
export const setFioExpiredCheckToDisklet = async (
  lastChecks: { [fioName: string]: Date },
  disklet: Disklet
): Promise<void> => {
  try {
    await disklet.setText(FIO_EXPIRED_CHECK, JSON.stringify(lastChecks))
  } catch (error: any) {
    console.log(error)
  }
}

export const fioMakeSpend = async <Name extends keyof FioMakeSpendParams>(
  fioWallet: EdgeCurrencyWallet,
  actionName: Name,
  params: FioMakeSpendParams[Name]
): Promise<EdgeTransaction> => {
  const fakeSpendTarget = { publicAddress: '', nativeAmount: '0' }
  const spendInfo: EdgeSpendInfo = {
    tokenId: null,
    spendTargets: [fakeSpendTarget],
    otherParams: {
      action: {
        name: actionName,
        params
      }
    }
  }
  const edgeTransaction = await fioWallet.makeSpend(spendInfo)
  return edgeTransaction
}

export const fioSignAndBroadcast = async (
  fioWallet: EdgeCurrencyWallet,
  unsignedEdgeTransaction: EdgeTransaction
): Promise<EdgeTransaction> => {
  const signedTx = await fioWallet.signTx(unsignedEdgeTransaction)
  const edgeTransaction = await fioWallet.broadcastTx(signedTx)
  return edgeTransaction
}

interface FioConnectedPublicAddresses {
  public_addresses: Array<{
    public_address: string
    token_code: string
    chain_code: string
  }>
}

/**
 * Check if wallet is connected to FIO Address
 *
 * @param fioWallet
 * @param fioAddress
 * @param wallet
 * @param tokenCode
 * @param chainCode
 * @param connectedWalletsFromDisklet
 * @returns {Promise<string>}
 */
const isWalletConnected = async (
  fioWallet: EdgeCurrencyWallet,
  connectedAddresses: FioConnectedPublicAddresses['public_addresses'],
  wallet: EdgeCurrencyWallet,
  tokenCode: string,
  chainCode: string,
  connectedWalletsFromDisklet: DiskletConnectedWallets
): Promise<boolean> => {
  try {
    chainCode = chainCode.toUpperCase()
    tokenCode = tokenCode.toUpperCase()
    const connectedAddressObj = connectedAddresses.find(
      connectedAddress =>
        connectedAddress.chain_code === chainCode &&
        connectedAddress.token_code === tokenCode.replace('.', '')
    )

    if (connectedAddressObj == null) return false
    const { public_address: connectedAddress } = connectedAddressObj

    const fullCurrencyCode = `${chainCode}:${tokenCode}`
    if (connectedWalletsFromDisklet[fullCurrencyCode]) {
      const { walletId, publicAddress: pubAddressFromDisklet } =
        connectedWalletsFromDisklet[fullCurrencyCode]
      if (
        walletId === wallet.id &&
        connectedAddress === pubAddressFromDisklet
      ) {
        return true
      }
    }
    const receiveAddress = await wallet.getReceiveAddress({ tokenId: null })
    if (connectedAddress === receiveAddress.publicAddress) return true
  } catch (e: any) {
    //
  }
  return false
}

/**
 * Set connected public addresses with FIO Address for all wallets in account
 *
 * @param fioAddress
 * @param fioWallet
 * @param wallets
 * @returns {Promise<CcWalletMap>}
 */
export const refreshConnectedWalletsForFioAddress = async (
  fioAddress: string,
  fioWallet: EdgeCurrencyWallet,
  wallets: EdgeCurrencyWallet[]
): Promise<CcWalletMap> => {
  const connectedWallets: StringMap = {}
  const connectedWalletsFromDisklet = await getConnectedWalletsForFioAddress(
    fioWallet,
    fioAddress
  )
  const { public_addresses: connectedAddresses }: FioConnectedPublicAddresses =
    await fioWallet.otherMethods.fioAction('getPublicAddresses', {
      fioAddress
    })
  for (const wallet of wallets) {
    const { currencyConfig, enabledTokenIds } = wallet
    const enabledCodes = enabledTokenIds
      .map(tokenId => currencyConfig.allTokens[tokenId]?.currencyCode)
      .filter(t => t != null)
    enabledCodes.push(wallet.currencyInfo.currencyCode)
    for (const currencyCode of enabledCodes) {
      const fullCurrencyCode = `${wallet.currencyInfo.currencyCode}:${currencyCode}`
      if (connectedWallets[fullCurrencyCode] != null) continue
      if (
        await isWalletConnected(
          fioWallet,
          connectedAddresses,
          wallet,
          currencyCode,
          wallet.currencyInfo.currencyCode,
          connectedWalletsFromDisklet
        )
      ) {
        connectedWallets[fullCurrencyCode] = wallet.id
      }
    }
  }
  return connectedWallets
}

type WalletArray = Array<{
  fullCurrencyCode: string
  walletId: string
}>

interface IterationObj {
  ccWalletArray: WalletArray

  publicAddresses: Array<{
    token_code: string
    chain_code: string
    public_address: string
  }>
}

/**
 * Update public addresses for FIO Address
 *
 * @param fioWallet
 * @param fioAddress
 * @param publicAddresses
 * @returns {Promise<void>}
 */
export const updatePubAddressesForFioAddress = async (
  account: EdgeAccount,
  fioWallet: EdgeCurrencyWallet | null,
  fioAddress: string,
  publicAddresses: FioConnectAddress[],
  isConnection: boolean = true
): Promise<{
  updatedCcWallets: Array<{ fullCurrencyCode: string; walletId: string }>
  error?: Error | FioError | null
}> => {
  if (!fioWallet) throw new Error(lstrings.fio_connect_wallets_err)
  const connectedWalletsFromDisklet = await getConnectedWalletsForFioAddress(
    fioWallet,
    fioAddress
  )
  let updatedCcWallets: WalletArray = []
  const iteration: IterationObj = {
    publicAddresses: [],
    ccWalletArray: []
  }
  const limitPerCall = 5
  for (const item of publicAddresses) {
    const { walletId } = item
    const fioChainCode = item.fioChainCode.toUpperCase()
    const fioTokenCode = item.fioTokenCode.toUpperCase()
    const fullCurrencyCode = `${fioChainCode}:${fioTokenCode}`
    let publicAddress = item.publicAddress

    if (isConnection) {
      connectedWalletsFromDisklet[fullCurrencyCode] = {
        walletId,
        publicAddress
      }
    } else {
      const { publicAddress: pubAddressFromStore } =
        connectedWalletsFromDisklet[fullCurrencyCode]
      if (pubAddressFromStore !== publicAddress) {
        publicAddress = pubAddressFromStore
      }
      delete connectedWalletsFromDisklet[fullCurrencyCode]
    }
    iteration.ccWalletArray.push({
      fullCurrencyCode,
      walletId
    })
    iteration.publicAddresses.push({
      token_code: fioTokenCode,
      chain_code: fioChainCode,
      public_address: publicAddress
    })
    if (iteration.publicAddresses.length === limitPerCall) {
      try {
        await updatePublicAddresses(
          account,
          fioWallet,
          fioAddress,
          iteration.publicAddresses,
          isConnection ? 'addPublicAddresses' : 'removePublicAddresses'
        )
        await setConnectedWalletsFromFile(
          fioWallet,
          fioAddress,
          connectedWalletsFromDisklet
        )
        updatedCcWallets = [...updatedCcWallets, ...iteration.ccWalletArray]
        iteration.publicAddresses = []
        iteration.ccWalletArray = []
      } catch (e: any) {
        return { updatedCcWallets, error: e }
      }
    }
  }

  if (iteration.publicAddresses.length) {
    try {
      await updatePublicAddresses(
        account,
        fioWallet,
        fioAddress,
        iteration.publicAddresses,
        isConnection ? 'addPublicAddresses' : 'removePublicAddresses'
      )
      await setConnectedWalletsFromFile(
        fioWallet,
        fioAddress,
        connectedWalletsFromDisklet
      )
      updatedCcWallets = [...updatedCcWallets, ...iteration.ccWalletArray]
    } catch (e: any) {
      return { updatedCcWallets, error: e }
    }
  }

  return { updatedCcWallets }
}

/**
 * Update public addresses for FIO Address API call method
 *
 * @param fioWallet
 * @param fioAddress
 * @param publicAddresses
 * @param action - addPublicAddresses or removePublicAddresses
 * @returns {Promise<void>}
 */
const updatePublicAddresses = async (
  account: EdgeAccount,
  fioWallet: EdgeCurrencyWallet,
  fioAddress: string,
  publicAddresses: Array<{
    token_code: string
    chain_code: string
    public_address: string
  }>,
  action: 'addPublicAddresses' | 'removePublicAddresses'
) => {
  let fee: string
  let edgeTx: EdgeTransaction
  try {
    edgeTx = await fioMakeSpend(fioWallet, action, {
      fioAddress,
      publicAddresses
    })
    fee = edgeTx.networkFee
  } catch (e: any) {
    console.error(e)
    throw new Error(lstrings.fio_get_fee_err_msg)
  }
  if (fee !== '0')
    throw new FioError(lstrings.fio_no_bundled_err_msg, FIO_NO_BUNDLED_ERR_CODE)
  await fioSignAndBroadcast(fioWallet, edgeTx)
}

/**
 * Search for FIO Wallet that has FIO Address
 *
 * @param fioWallets
 * @param fioAddress
 * @returns {Promise<*>}
 */
export const findWalletByFioAddress = async (
  fioWallets: EdgeCurrencyWallet[],
  fioAddress: string
): Promise<EdgeCurrencyWallet | null> => {
  if (fioWallets) {
    for (const wallet of fioWallets) {
      const fioAddresses: string[] =
        await wallet.otherMethods.getFioAddressNames()
      for (const address of fioAddresses) {
        if (address.toLowerCase() === fioAddress.toLowerCase()) {
          return wallet
        }
      }
    }
  }

  return null
}

export const checkPubAddress = async (
  fioPlugin: EdgeCurrencyConfig,
  fioAddress: string,
  chainCode: string,
  tokenCode: string
): Promise<string> => {
  try {
    const { public_address: publicAddress } =
      await fioPlugin.otherMethods.getConnectedPublicAddress(
        fioAddress.toLowerCase(),
        chainCode,
        tokenCode
      )
    return publicAddress
  } catch (e: any) {
    if (
      e.labelCode &&
      e.labelCode ===
        fioPlugin.currencyInfo.defaultSettings?.errorCodes.INVALID_FIO_ADDRESS
    ) {
      throw new FioError(
        lstrings.fio_error_invalid_address,
        fioPlugin.currencyInfo.defaultSettings?.errorCodes.INVALID_FIO_ADDRESS
      )
    }
    if (
      e.labelCode &&
      e.labelCode ===
        fioPlugin.currencyInfo.defaultSettings?.errorCodes
          .FIO_ADDRESS_IS_NOT_EXIST
    ) {
      throw new FioError(
        lstrings.send_fio_request_error_addr_not_exist,
        fioPlugin.currencyInfo.defaultSettings?.errorCodes.FIO_ADDRESS_IS_NOT_EXIST
      )
    }
    if (
      e.labelCode &&
      e.labelCode ===
        fioPlugin.currencyInfo.defaultSettings?.errorCodes
          .FIO_ADDRESS_IS_NOT_LINKED
    ) {
      throw new FioError(
        sprintf(lstrings.err_address_not_linked_title, tokenCode),
        fioPlugin.currencyInfo.defaultSettings?.errorCodes.FIO_ADDRESS_IS_NOT_LINKED
      )
    }
    throw new Error(lstrings.fio_connect_wallets_err)
  }
}

export const addToFioAddressCache = async (
  account: EdgeAccount,
  fioAddressesToAdd: string[]
): Promise<FioAddresses> => {
  const fioAddressesObject = await getFioAddressCache(account)
  let writeToDisklet = false

  for (const fioAddressToAdd of fioAddressesToAdd) {
    if (!fioAddressesObject.addresses[fioAddressToAdd]) {
      fioAddressesObject.addresses[fioAddressToAdd] = true
      writeToDisklet = true
    }
  }

  if (writeToDisklet) {
    await account.disklet.setText(
      FIO_ADDRESS_CACHE,
      JSON.stringify(fioAddressesObject)
    )
  }
  return fioAddressesObject
}

export const getFioAddressCache = async (
  account: EdgeAccount
): Promise<FioAddresses> => {
  try {
    const fioAddressObject = await account.disklet.getText(FIO_ADDRESS_CACHE)
    return JSON.parse(fioAddressObject)
  } catch (e: any) {
    return { addresses: {} }
  }
}

export const checkRecordSendFee = async (
  fioWallet: EdgeCurrencyWallet | null,
  fioAddress: string
) => {
  if (!fioWallet) throw new Error(lstrings.fio_wallet_missing_for_fio_address)
  let getFeeResult: string
  try {
    const edgeTx = await fioMakeSpend(fioWallet, 'recordObtData', {
      ...FIO_FAKE_RECORD_OBT_DATA_REQUEST,
      payerFioAddress: fioAddress
    })
    getFeeResult = edgeTx.networkFee
  } catch (e: any) {
    throw new Error(lstrings.fio_get_fee_err_msg)
  }
  const bundles = await getRemainingBundles(fioWallet, fioAddress)
  // record_obt_data requires 2 bundled transactions
  if (getFeeResult !== '0' || bundles < 2) {
    throw new FioError(
      `${lstrings.fio_no_bundled_err_msg} ${lstrings.fio_no_bundled_add_err_msg}`,
      FIO_NO_BUNDLED_ERR_CODE
    )
  }
}

interface RecordObtDataParams {
  payerFioAddress: string
  payeeFioAddress: string
  payerPublicAddress: string
  payeePublicAddress: string
  amount: string
  tokenCode: string
  chainCode: string
  obtId: string
  memo: string
  status?: 'cancelled' | 'rejected' | 'requested' | 'sent_to_blockchain'
  fioRequestId?: number
}

export const recordSend = async (
  senderWallet: EdgeCurrencyWallet,
  senderFioAddress: string,
  params: {
    payeeFioAddress: string
    payerPublicAddress: string
    payeePublicAddress: string
    amount: string
    currencyCode: string
    chainCode: string
    txid: string
    memo: string
    fioRequestId?: number
  }
) => {
  const {
    payeeFioAddress,
    payerPublicAddress,
    payeePublicAddress,
    amount,
    currencyCode,
    chainCode,
    txid,
    memo,
    fioRequestId
  } = params
  if (senderFioAddress === '' || payeePublicAddress === '') return

  let actionParams: RecordObtDataParams = {
    payerFioAddress: senderFioAddress,
    payeeFioAddress,
    payerPublicAddress,
    payeePublicAddress,
    amount,
    tokenCode: currencyCode,
    chainCode,
    obtId: txid,
    memo,
    status: 'sent_to_blockchain'
  }
  if (fioRequestId) {
    actionParams = { ...actionParams, fioRequestId }
  }
  const edgeTx = await fioMakeSpend(senderWallet, 'recordObtData', actionParams)
  const signedTx = await senderWallet.signTx(edgeTx)
  await senderWallet.broadcastTx(signedTx)
  await senderWallet.saveTx(signedTx)
}

export const getFioObtData = async (
  fioWallets: EdgeCurrencyWallet[]
): Promise<FioObtRecord[]> => {
  let obtDataRecords: FioObtRecord[] = []
  for (const fioWallet of fioWallets) {
    try {
      const lastRecords = await fioWallet.otherMethods.fetchObtData()

      obtDataRecords = [...obtDataRecords, ...(lastRecords ?? [])]
    } catch (e: any) {
      console.error('getFioObtData error: ', String(e))
    }
  }

  return obtDataRecords
}

export const getFioDomains = async (
  fioPlugin: EdgeCurrencyConfig,
  fioAddress: string,
  chainCode: string,
  tokenCode: string
): Promise<string> => {
  const isFioAddress = await fioPlugin.otherMethods.isFioAddressValid(
    fioAddress
  )
  try {
    if (isFioAddress) {
      const { public_address: publicAddress } =
        await fioPlugin.otherMethods.getConnectedPublicAddress(
          fioAddress.toLowerCase(),
          chainCode,
          tokenCode
        )
      if (publicAddress && publicAddress.length > 1) {
        return publicAddress
      }
    }
  } catch (e: any) {
    throw new Error(lstrings.err_no_address_title)
  }

  return ''
}

export const checkIsDomainPublic = async (
  fioPlugin: EdgeCurrencyConfig,
  domain: string
): Promise<string | true> => {
  let isDomainPublic = false
  try {
    isDomainPublic = fioPlugin.otherMethods
      ? await fioPlugin.otherMethods.isDomainPublic(domain)
      : false
  } catch (e: any) {
    if (
      e.labelCode &&
      e.labelCode ===
        fioPlugin.currencyInfo.defaultSettings?.errorCodes
          .FIO_DOMAIN_IS_NOT_EXIST
    ) {
      return lstrings.fio_get_reg_info_domain_err_msg
    }

    return lstrings.fio_connect_wallets_err
  }

  if (!isDomainPublic) {
    return lstrings.fio_address_register_domain_is_not_public
  }

  return true
}

/**
 *
 * @param fioPlugin
 * @param fioAddress
 * @param selectedWallet
 * @param selectedDomain
 * @param displayDenomination
 * @param isFallback
 * @returns {Promise<{activationCost: number, feeValue: number, paymentInfo: PaymentInfo}>}
 */
export const getRegInfo = async (
  fioPlugin: EdgeCurrencyConfig,
  fioAddress: string,
  selectedWallet: EdgeCurrencyWallet,
  selectedDomain: FioDomain,
  displayDenomination: EdgeDenomination,
  isFallback: boolean = false
): Promise<{
  supportedAssets: EdgeAsset[]
  activationCost: number
  feeValue: number
  paymentInfo: PaymentInfo
  bitpayUrl: string
}> => {
  let activationCost = 0
  let feeValue = 0

  try {
    const edgeTx = await fioMakeSpend(selectedWallet, 'registerFioAddress', {
      fioAddress
    })
    feeValue = parseInt(edgeTx.networkFee)
    activationCost = parseFloat(
      truncateDecimals(
        div(`${feeValue}`, displayDenomination.multiplier, DECIMAL_PRECISION)
      )
    )
  } catch (e: any) {
    throw new Error(lstrings.fio_get_fee_err_msg)
  }

  if (
    selectedDomain.walletId ||
    // Fall back to only allowing FIO payments if no fioRegApiToken is configured
    (typeof ENV.FIO_INIT === 'object' && ENV.FIO_INIT.fioRegApiToken === '')
  ) {
    return {
      activationCost,
      feeValue,
      supportedAssets: [{ pluginId: 'fio', tokenId: null }],
      paymentInfo: {
        [FIO_STR]: {
          '': {
            amount: `${activationCost}`,
            nativeAmount: ''
          }
        }
      },
      bitpayUrl: ''
    }
  }
  // todo: temporary commented to use fallback referral code by default.
  // const referralCode = isFallback ? fioPlugin.currencyInfo.defaultSettings.fallbackRef : fioPlugin.currencyInfo.defaultSettings.defaultRef
  const reqResult = await buyAddressRequest(
    fioPlugin,
    fioAddress,
    fioPlugin.currencyInfo.defaultSettings?.fallbackRef,
    selectedWallet,
    activationCost
  )
  return {
    ...reqResult,
    feeValue
  }
}

/**
 *
 * @param fioPlugin
 * @param fioDomain
 * @param selectedWallet
 * @param displayDenomination
 * @returns {Promise<{activationCost: number, feeValue: number, supportedCurrencies:{[key: string]: boolean}, paymentInfo: {[key: string]: {amount: string, address: string}}}>}
 */
export const getDomainRegInfo = async (
  fioPlugin: EdgeCurrencyConfig,
  fioDomain: string,
  selectedWallet: EdgeCurrencyWallet,
  displayDenomination: EdgeDenomination
): Promise<{
  supportedAssets: EdgeAsset[]
  activationCost: number
  feeValue: number
  paymentInfo: PaymentInfo
  bitpayUrl: string
}> => {
  let activationCost = 0
  let feeValue = 0

  try {
    const edgeTx = await fioMakeSpend(selectedWallet, 'registerFioDomain', {
      fioDomain
    })
    feeValue = parseInt(edgeTx.networkFee)
    activationCost = parseFloat(
      truncateDecimals(
        div(`${feeValue}`, displayDenomination.multiplier, DECIMAL_PRECISION)
      )
    )
  } catch (e: any) {
    throw new Error(lstrings.fio_get_fee_err_msg)
  }

  const reqResult = await buyAddressRequest(
    fioPlugin,
    fioDomain,
    fioPlugin.currencyInfo.defaultSettings?.defaultRef,
    selectedWallet,
    activationCost
  )
  return {
    ...reqResult,
    feeValue
  }
}

export interface PaymentInfo {
  [pluginId: string]: {
    [tokenIdString: string]: { amount: string; nativeAmount: string }
  }
}

const buyAddressRequest = async (
  fioPlugin: EdgeCurrencyConfig,
  address: string,
  referralCode: string,
  selectedWallet: EdgeCurrencyWallet,
  activationCost: number
): Promise<{
  supportedAssets: EdgeAsset[]
  activationCost: number
  paymentInfo: PaymentInfo
  bitpayUrl: string
}> => {
  try {
    const buyAddressResponse = asBitpayResponse(
      await fioPlugin.otherMethods.buyAddressRequest({
        address,
        referralCode,
        publicKey: selectedWallet.publicWalletInfo.keys.publicKey
      })
    )

    const paymentInfo: PaymentInfo = {
      [FIO_STR]: {
        '': {
          amount: `${activationCost}`,
          nativeAmount: ''
        }
      }
    }

    const supportedAssets: EdgeAsset[] = []
    const { id, paymentCodes, paymentSubtotals, paymentDisplaySubTotals } =
      buyAddressResponse.success.charge
    for (const currencyKey of Object.keys(paymentCodes)) {
      // const currencyCode = buyAddressResponse.success.charge.pricing[currencyKey].currency
      const asset = PAYMENT_PROTOCOL_MAP[currencyKey]
      const amount = asMaybe(asIntegerString)(
        paymentSubtotals[currencyKey].toString()
      )

      if (asset == null || amount == null) {
        continue
      }

      supportedAssets.push(asset)
      const { pluginId, tokenId } = asset

      if (paymentInfo[pluginId] == null) {
        paymentInfo[pluginId] = {}
      }
      paymentInfo[pluginId][tokenId ?? ''] = {
        amount: paymentDisplaySubTotals[currencyKey].toString(),
        nativeAmount: paymentSubtotals[currencyKey].toString()
      }
    }

    return {
      activationCost,
      supportedAssets,
      paymentInfo,
      bitpayUrl: `https://bitpay.com/i/${id}`
    }
  } catch (e: any) {
    const errorMessages = {
      [fioPlugin.currencyInfo.defaultSettings?.errorCodes.INVALID_FIO_ADDRESS]:
        lstrings.fio_error_invalid_address,
      [fioPlugin.currencyInfo.defaultSettings?.errorCodes
        .FIO_DOMAIN_IS_NOT_EXIST]: lstrings.fio_get_reg_info_domain_err_msg,
      [fioPlugin.currencyInfo.defaultSettings?.errorCodes
        .FIO_DOMAIN_IS_NOT_PUBLIC]:
        lstrings.fio_address_register_domain_is_not_public,
      [fioPlugin.currencyInfo.defaultSettings?.errorCodes.SERVER_ERROR]:
        lstrings.fio_get_reg_info_err_msg,
      [fioPlugin.currencyInfo.defaultSettings?.errorCodes
        .ALREADY_SENT_REGISTRATION_REQ_FOR_DOMAIN]:
        lstrings.fio_get_reg_info_already_sent_err_msg,
      [fioPlugin.currencyInfo.defaultSettings?.errorCodes.ALREADY_REGISTERED]:
        lstrings.fio_address_register_screen_not_available
    }
    if (e.labelCode && errorMessages[e.labelCode]) {
      throw new Error(errorMessages[e.labelCode])
    }
  }
  throw new Error(lstrings.fio_get_reg_info_err_msg)
}

export const getRemainingBundles = async (
  fioWallet: EdgeCurrencyWallet,
  fioName: string
): Promise<number> => {
  let numBundles = Infinity
  try {
    const fioAddresses: FioAddress[] =
      await fioWallet.otherMethods.getFioAddresses()
    const fioAddress = fioAddresses.find(
      fioAddress => fioAddress.name === fioName
    )
    if (fioAddress != null) numBundles = fioAddress.bundledTxs
  } catch (e: any) {
    // If getFioAddresses fails, it's best to assume a lot of bundles remain so that the user can still attempt to complete whatever action follows
    console.log('getRemainingBundles error - ', e?.message)
  }
  return numBundles
}

export const getAddBundledTxsFee = async (
  fioWallet: EdgeCurrencyWallet | null
): Promise<number> => {
  if (fioWallet) {
    try {
      const edgeTx = await fioMakeSpend(fioWallet, 'addBundledTransactions', {
        fioAddress: '',
        bundleSets: DEFAULT_BUNDLE_SET_VALUE
      })
      return parseInt(edgeTx.networkFee)
    } catch (e: any) {
      throw new Error(lstrings.fio_get_fee_err_msg)
    }
  }
  throw new Error(lstrings.fio_get_fee_err_msg)
}

export const addBundledTxs = async (
  fioWallet: EdgeCurrencyWallet | null,
  fioAddress: string,
  fee: number
): Promise<void> => {
  if (fioWallet) {
    try {
      let edgeTx = await fioMakeSpend(fioWallet, 'addBundledTransactions', {
        fioAddress,
        bundleSets: DEFAULT_BUNDLE_SET_VALUE
      })
      edgeTx = await fioSignAndBroadcast(fioWallet, edgeTx)
      await fioWallet.saveTx(edgeTx)

      const expiration = edgeTx.otherParams?.broadcastResult?.expiration
      return expiration
    } catch (e: any) {
      throw new Error(lstrings.fio_add_bundled_txs_err_msg)
    }
  }
  throw new Error(lstrings.fio_add_bundled_txs_err_msg)
}

export const getRenewalFee = async (
  fioWallet: EdgeCurrencyWallet | null
): Promise<number> => {
  if (fioWallet) {
    try {
      const edgeTx = await fioMakeSpend(fioWallet, 'renewFioDomain', {
        fioDomain: ''
      })
      return parseInt(edgeTx.networkFee)
    } catch (e: any) {
      throw new Error(lstrings.fio_get_fee_err_msg)
    }
  }
  throw new Error(lstrings.fio_get_fee_err_msg)
}

export const renewFioDomain = async (
  fioWallet: EdgeCurrencyWallet | null,
  fioDomain: string,
  fee: number
): Promise<{ expiration: string }> => {
  const errorStr = sprintf(
    lstrings.fio_renew_err_msg,
    lstrings.fio_domain_label
  )
  if (fioWallet) {
    try {
      let edgeTx = await fioMakeSpend(fioWallet, 'renewFioDomain', {
        fioDomain
      })
      edgeTx = await fioSignAndBroadcast(fioWallet, edgeTx)
      const expiration = edgeTx.otherParams?.broadcastResult?.expiration
      return { expiration }
    } catch (e: any) {
      throw new Error(errorStr)
    }
  }
  throw new Error(errorStr)
}

export const getDomainSetVisibilityFee = async (
  fioWallet: EdgeCurrencyWallet | null
): Promise<number> => {
  if (fioWallet) {
    try {
      const edgeTx = await fioMakeSpend(fioWallet, 'setFioDomainVisibility', {
        fioDomain: '',
        isPublic: true
      })
      return parseInt(edgeTx.networkFee)
    } catch (e: any) {
      throw new Error(lstrings.fio_get_fee_err_msg)
    }
  }
  throw new Error(lstrings.fio_get_fee_err_msg)
}

export const setDomainVisibility = async (
  fioWallet: EdgeCurrencyWallet | null,
  fioDomain: string,
  isPublic: boolean,
  fee: number
): Promise<{ expiration: string }> => {
  if (fioWallet) {
    try {
      let edgeTx = await fioMakeSpend(fioWallet, 'setFioDomainVisibility', {
        fioDomain,
        isPublic
      })
      edgeTx = await fioSignAndBroadcast(fioWallet, edgeTx)
      const expiration = edgeTx.otherParams?.broadcastResult?.expiration
      return { expiration }
    } catch (e: any) {
      throw new Error(lstrings.fio_domain_set_visibility_err)
    }
  }
  throw new Error(lstrings.fio_domain_set_visibility_err)
}

export const getTransferFee = async (
  fioWallet: EdgeCurrencyWallet | null,
  forDomain: boolean = false
): Promise<number> => {
  if (fioWallet) {
    try {
      if (forDomain) {
        const edgeTx = await fioMakeSpend(fioWallet, 'transferFioDomain', {
          fioDomain: ''
        })
        return parseInt(edgeTx.networkFee)
      } else {
        const edgeTx = await fioMakeSpend(fioWallet, 'transferFioAddress', {
          fioAddress: ''
        })
        return parseInt(edgeTx.networkFee)
      }
    } catch (e: any) {
      throw new Error(lstrings.fio_get_fee_err_msg)
    }
  }
  throw new Error(lstrings.fio_get_fee_err_msg)
}

export const cancelFioRequest = async (
  fioWallet: EdgeCurrencyWallet | null,
  fioRequestId: number,
  fioAddress: string
) => {
  if (!fioWallet) throw new Error(lstrings.fio_wallet_missing_for_fio_address)
  let getFeeResult: string
  let edgeTx: EdgeTransaction
  try {
    edgeTx = await fioMakeSpend(fioWallet, 'cancelFundsRequest', {
      fioAddress,
      fioRequestId
    })
    getFeeResult = edgeTx.networkFee
  } catch (e: any) {
    throw new Error(lstrings.fio_get_fee_err_msg)
  }
  if (getFeeResult !== '0') {
    throw new FioError(
      `${lstrings.fio_no_bundled_err_msg} ${lstrings.fio_no_bundled_add_err_msg}`,
      FIO_NO_BUNDLED_ERR_CODE
    )
  }
  try {
    edgeTx = await fioSignAndBroadcast(fioWallet, edgeTx)
    await fioWallet.saveTx(edgeTx)
  } catch (e: any) {
    throw new Error(lstrings.fio_cancel_request_error)
  }
}

export const expiredSoon = (expDate: string): boolean => {
  return new Date(expDate).getTime() - new Date().getTime() < MONTH
}

export const needToCheckExpired = (
  lastChecks: { [fioName: string]: Date },
  fioName: string
): boolean => {
  try {
    let lastCheck = lastChecks[fioName]
    if (!lastCheck) {
      lastCheck = new Date()
      lastCheck.setMonth(new Date().getMonth() - 1)
    }
    const now = new Date()
    return (
      now.getDate() !== lastCheck.getDate() ||
      now.getMonth() !== lastCheck.getMonth() ||
      now.getFullYear() !== lastCheck.getFullYear()
    )
  } catch (e: any) {
    //
  }
  return false
}

export const getExpiredSoonFioDomains = (
  fioDomains: FioDomain[]
): FioDomain[] => {
  const expiredFioDomains: FioDomain[] = []
  for (const fioDomain of fioDomains) {
    if (expiredSoon(fioDomain.expiration)) {
      expiredFioDomains.push(fioDomain)
    }
  }

  return expiredFioDomains
}

export const refreshFioNames = async (
  fioWallets: EdgeCurrencyWallet[]
): Promise<{
  fioAddresses: FioAddress[]
  fioDomains: FioDomain[]
  fioWalletsById: { [key: string]: EdgeCurrencyWallet }
}> => {
  const fioWalletsById: { [key: string]: EdgeCurrencyWallet } = {}
  let fioAddresses: FioAddress[] = []
  let fioDomains: FioDomain[] = []

  if (fioWallets != null) {
    for (const wallet of fioWallets) {
      const walletId = wallet.id
      const walletFioAddresses: FioAddress[] =
        await wallet.otherMethods.getFioAddresses()
      fioAddresses = [
        ...fioAddresses,
        ...walletFioAddresses.map(({ name, bundledTxs }) => ({
          name,
          bundledTxs,
          walletId
        }))
      ]
      const walletFioDomains: FioDomain[] =
        await wallet.otherMethods.getFioDomains()
      fioDomains = [
        ...fioDomains,
        ...walletFioDomains.map(({ name, expiration, isPublic }) => ({
          name,
          expiration,
          isPublic,
          walletId
        }))
      ]
      fioWalletsById[walletId] = wallet
    }
  }

  return { fioAddresses, fioDomains, fioWalletsById }
}

const asBitpayResponse = asObject({
  success: asObject({
    charge: asObject({
      id: asString,
      paymentSubtotals: asObject(asNumber),
      paymentDisplaySubTotals: asObject(asString),
      paymentCodes: asObject(asObject(asString))
    })
  })
})
