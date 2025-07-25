import '@ethersproject/shims'

import { add, div, gt, gte, lte, mul, sub } from 'biggystring'
import { BigNumber, ethers } from 'ethers'
import { sprintf } from 'sprintf-js'

import { showWarning } from '../../../../components/services/AirshipInstance'
import { lstrings } from '../../../../locales/strings'
import { HumanFriendlyError } from '../../../../types/HumanFriendlyError'
import VELODROME_V2_VOTER from '../../../abi/VELODROME_V2_VOTER.json'
import { cacheTxMetadata } from '../../metadataCache'
import {
  ChangeQuote,
  ChangeQuoteRequest,
  PositionAllocation,
  QuoteAllocation,
  StakeAssetInfo,
  StakePosition,
  StakePositionRequest
} from '../../types'
import { makeBigAccumulator } from '../../util/accumulator'
import { round } from '../../util/biggystringplus'
import { makeBuilder } from '../../util/builder'
import { fromHex } from '../../util/hex'
import { pluginInfo } from '../pluginInfo'
import { optimismEcosystem as eco } from '../policyInfo/optimism'
import { StakePolicyInfo } from '../stakePolicy'
import { StakePluginPolicy } from '../types'

export interface UniswapV2LpPolicyOptions {
  disableStake?: boolean
  disableUnstake?: boolean
  disableClaim?: boolean
  isStablePool: boolean
  lpTokenContract: ethers.Contract
  stakingContract: ethers.Contract
  swapRouterContract: ethers.Contract
  tokenAContract: ethers.Contract
  tokenBContract: ethers.Contract
}

export const makeVelodromeV2StakePolicy = (
  options: UniswapV2LpPolicyOptions
): StakePluginPolicy => {
  // Declare contracts:
  const {
    disableStake = false,
    disableUnstake = false,
    disableClaim = false,
    isStablePool,
    stakingContract,
    lpTokenContract,
    swapRouterContract,
    tokenAContract,
    tokenBContract
  } = options

  // TODO: Replace DECIMAL hardcode with a configuration for each asset from `options`
  const DECIMALS = 18
  const SLIPPAGE = 0.03 // 3%
  const SLIPPAGE_FACTOR = 1 - SLIPPAGE // A multiplier to get a minimum amount
  const DEADLINE_OFFSET = 60 * 60 * 12 // 12 hours

  const serializeAssetId = (assetId: StakeAssetInfo) =>
    `${assetId.pluginId}:${assetId.currencyCode}`

  async function lpTokenToAssetPairAmounts(
    policyInfo: StakePolicyInfo,
    lpTokenAmount: string
  ): Promise<{
    [assetId: string]: {
      pluginId: string
      currencyCode: string
      nativeAmount: string
    }
  }> {
    // 1. Get the total supply of LP-tokens in the LP-pool contract
    const lpTokenSupply = (
      await eco.multipass(p => lpTokenContract.connect(p).totalSupply())
    ).toString()
    // 2. Get the amount of each token reserve in the LP-pool contract
    const reservesMap = await getTokenReservesMap()
    // 3. Get the amount of each token in for the policy
    return policyInfo.stakeAssets.reduce((acc, assetId, index) => {
      const address = assetToContractAddress(policyInfo, assetId)
      const reserve = reservesMap[address]
      if (reserve == null)
        throw new Error(
          `Could not find reserve amount in liquidity pool for ${assetId.currencyCode}`
        )
      const nativeAmount = div(mul(reserve, lpTokenAmount), lpTokenSupply)
      return { ...acc, [serializeAssetId(assetId)]: { nativeAmount } }
    }, {})
  }

  async function getExpectedLiquidityAmount(
    policyInfo: StakePolicyInfo,
    allocation: QuoteAllocation
  ): Promise<string> {
    // 1. Calculate the liquidity amount (LP-token amount) from the unstake-allocations
    const lpTokenSupply = (
      await eco.multipass(p => lpTokenContract.connect(p).totalSupply())
    ).toString()
    const reservesMap = await getTokenReservesMap()
    const tokenContractAddress = assetToContractAddress(policyInfo, allocation)
    const tokenSupplyInReserve = reservesMap[tokenContractAddress]
    const liquidity = round(
      mul(
        div(allocation.nativeAmount, tokenSupplyInReserve, DECIMALS),
        fromHex(lpTokenSupply)
      )
    )
    return liquidity
  }

  async function getTokenReservesMap(): Promise<{
    [contractAddress: string]: string
  }> {
    const reservesResponse = await eco.multipass(p =>
      lpTokenContract.connect(p).getReserves()
    )
    const { _reserve0, _reserve1 } = reservesResponse
    const [token0, token1] = await Promise.all([
      eco.multipass(p => lpTokenContract.connect(p).token0()),
      eco.multipass(p => lpTokenContract.connect(p).token1())
    ])
    const reservesMap = {
      [token0.toLowerCase()]: _reserve0.toString(),
      [token1.toLowerCase()]: _reserve1.toString()
    }
    return reservesMap
  }

  function assetToContractAddress(
    policyInfo: StakePolicyInfo,
    assetId: StakeAssetInfo
  ): string {
    const contractInfo = eco.getContractInfo(assetId.currencyCode)
    const { address } = contractInfo
    return address.toLowerCase()
  }

  const instance: StakePluginPolicy = {
    async fetchChangeQuote(request: ChangeQuoteRequest): Promise<ChangeQuote> {
      const { action, stakePolicyId, wallet, account } = request

      const policyInfo = pluginInfo.policyInfo.find(
        p => p.stakePolicyId === stakePolicyId
      )
      if (policyInfo == null)
        throw new Error(`Stake policy '${stakePolicyId}' not found`)

      const requestAsset = [
        ...policyInfo.stakeAssets,
        ...policyInfo.rewardAssets
      ].find(asset => asset.currencyCode === request.currencyCode)
      if (requestAsset == null)
        throw new Error(
          `Asset '${request.currencyCode}' not found in policy '${stakePolicyId}'`
        )

      const parentCurrencyCode = policyInfo.parentCurrencyCode
      const tokenACurrencyCode = policyInfo.stakeAssets[0].currencyCode
      const tokenBCurrencyCode = policyInfo.stakeAssets[1].currencyCode
      const isTokenANative =
        tokenACurrencyCode === policyInfo.parentCurrencyCode
      const isTokenBNative =
        tokenBCurrencyCode === policyInfo.parentCurrencyCode
      if (isTokenANative && isTokenBNative)
        throw new Error('Stake plugin does not support two native assets')

      // Metadata constants:
      const metadataName = 'Velodrome Finance'
      const metadataLpName = `${tokenACurrencyCode} - ${tokenBCurrencyCode}`

      // Get the signer for the wallet
      const signerSeed = await account.getDisplayPrivateKey(wallet.id)
      const signerAddress = await eco.makeSigner(signerSeed).getAddress()

      // TODO: Infer this policy from the `options` if/when we support more than two stake assets
      if (policyInfo.stakeAssets.length > 2)
        throw new Error(`Staking more than two assets is not supported`)

      //
      // Calculate the allocations (stake/unstake/claim) amounts
      //

      const allocations: QuoteAllocation[] = []

      // Calculate the stake asset native amounts:
      if (action === 'stake' || action === 'unstake') {
        const reservesMap = await getTokenReservesMap()
        const requestTokenContractAddress = assetToContractAddress(
          policyInfo,
          requestAsset
        )
        const requestTokenReserves = reservesMap[requestTokenContractAddress]

        allocations.push(
          ...policyInfo.stakeAssets.map<QuoteAllocation>(
            ({ pluginId, currencyCode }, index) => {
              const tokenContractAddress = assetToContractAddress(policyInfo, {
                pluginId,
                currencyCode
              })
              const tokenReserves = reservesMap[tokenContractAddress]
              const nativeAmount = div(
                mul(tokenReserves, request.nativeAmount),
                requestTokenReserves
              )
              return {
                allocationType: action,
                pluginId,
                currencyCode,
                nativeAmount
              }
            }
          )
        )
      }
      // Calculate the claim asset native amounts:
      if (action === 'claim' || action === 'unstake') {
        const rewardNativeAmount = (
          await eco.multipass(p =>
            stakingContract.connect(p).earned(signerAddress)
          )
        ).toString()
        allocations.push(
          ...policyInfo.rewardAssets.map<QuoteAllocation>(
            ({ currencyCode, pluginId }) => {
              return {
                allocationType: 'claim',
                pluginId,
                currencyCode,
                nativeAmount: rewardNativeAmount
              }
            }
          )
        )
      }

      //
      // Build transaction workflow
      //

      // Signer
      const signer = eco.makeSigner(signerSeed)

      // Get the gasPrice oracle data (from wallet)
      const gasPrice = await eco.multipass(async p => await p.getGasPrice())

      // Accumulators
      const gasLimitAcc = makeBigAccumulator('0')
      let txCount: number = await signer.getTransactionCount('pending')
      const nextNonce = (): number => txCount++

      // Transaction builder
      const txs = makeBuilder(
        async fn =>
          await eco.multipass(provider =>
            fn({ signer: signer.connect(provider) })
          )
      )

      //
      // Stake
      //
      if (action === 'stake') {
        // 1. Check balance of staked assets and unstaked LP-token to determine if the user can stake
        const lpTokenBalance = (
          await eco.multipass(p =>
            lpTokenContract.connect(p).balanceOf(signerAddress)
          )
        ).toString()
        const assetAmountsFromLp = await lpTokenToAssetPairAmounts(
          policyInfo,
          lpTokenBalance
        )
        await Promise.all(
          allocations
            .filter(allocation => allocation.allocationType === 'stake')
            .map(async allocation => {
              const balanceResponse = await (async () => {
                const isNativeToken =
                  allocation.currencyCode === policyInfo.parentCurrencyCode
                if (isNativeToken) {
                  return await eco.multipass(
                    async p => await p.getBalance(signerAddress)
                  )
                }
                const tokenAContract = eco.makeContract(allocation.currencyCode)
                return await eco.multipass(p =>
                  tokenAContract.connect(p).balanceOf(signerAddress)
                )
              })()
              const balanceAmount = fromHex(balanceResponse._hex)
              const fromLpToken =
                assetAmountsFromLp[serializeAssetId(allocation)].nativeAmount
              const totalBalance = add(balanceAmount, fromLpToken)
              const isBalanceEnough = lte(allocation.nativeAmount, totalBalance)
              if (!isBalanceEnough) {
                throw new HumanFriendlyError(
                  lstrings.stake_error_insufficient_s,
                  allocation.currencyCode
                )
              }
            })
        )

        // 2. Approve Swap Router contract for every stake token contract (excluding native token)
        await Promise.all(
          allocations.map(async allocation => {
            // We don't need to approve the stake pool contract for the token earned token contract
            if (allocation.allocationType === 'claim') return
            // We don't need to approve the native token asset
            const isNativeToken =
              allocation.currencyCode === policyInfo.parentCurrencyCode
            if (isNativeToken) return

            const tokenContract = eco.makeContract(allocation.currencyCode)
            const spenderAddress = swapRouterContract.address
            txs.build(
              (gasLimit =>
                async function approveSwapRouter({ signer }) {
                  const allowanceResult = await tokenContract.allowance(
                    signer.address,
                    spenderAddress
                  )
                  if (allowanceResult.gte(allocation.nativeAmount)) return

                  const result = await tokenContract
                    .connect(signer)
                    .approve(
                      spenderAddress,
                      BigNumber.from(allocation.nativeAmount),
                      {
                        gasLimit,
                        gasPrice,
                        nonce: nextNonce()
                      }
                    )
                  cacheTxMetadata(result.hash, parentCurrencyCode, {
                    name: metadataName,
                    category: 'Expense:Fees',
                    notes: `Approve ${metadataLpName} liquidity pool contract`
                  })
                })(gasLimitAcc('100000'))
            )
          })
        )

        // 3. Add liquidity to to Swap Router contract
        txs.build(
          ((gasLimit, lpTokenBalance) =>
            async function addLiquidity({ signer }) {
              const tokenAAllocation = allocations.find(
                allocation =>
                  allocation.allocationType === action &&
                  allocation.currencyCode === tokenACurrencyCode
              )
              const tokenBAllocation = allocations.find(
                allocation =>
                  allocation.allocationType === action &&
                  allocation.currencyCode === tokenBCurrencyCode
              )

              if (tokenAAllocation == null)
                throw new Error(
                  `Contract token ${tokenACurrencyCode} not found in asset pair`
                )
              if (tokenBAllocation == null)
                throw new Error(
                  `Contract token ${tokenBCurrencyCode} not found in asset pair`
                )

              // Existing liquidity that may be unstaked due to a previous failed attempt to stake, or some other reason
              const expectedLiquidityAmount = await getExpectedLiquidityAmount(
                policyInfo,
                tokenAAllocation
              )
              // Figure out how much LP-tokens we need to add
              const assetAmountsFromExpectedLiquidity =
                await lpTokenToAssetPairAmounts(
                  policyInfo,
                  expectedLiquidityAmount
                )
              const tokenAAmountFromExpectedLiquidity =
                assetAmountsFromExpectedLiquidity[
                  serializeAssetId(tokenAAllocation)
                ].nativeAmount
              const tokenBAmountFromexpectedLiquidity =
                assetAmountsFromExpectedLiquidity[
                  serializeAssetId(tokenBAllocation)
                ].nativeAmount

              // Prepare the contract parameters
              const amountTokenADesired = tokenAAmountFromExpectedLiquidity
              const amountTokenAMin = round(
                mul(
                  tokenAAmountFromExpectedLiquidity,
                  SLIPPAGE_FACTOR.toString()
                )
              )
              const amountTokenBDesired = tokenBAmountFromexpectedLiquidity
              const amountTokenBMin = round(
                mul(
                  tokenBAmountFromexpectedLiquidity,
                  SLIPPAGE_FACTOR.toString()
                )
              )
              const deadline = Math.round(Date.now() / 1000) + DEADLINE_OFFSET

              let result
              if (isTokenANative || isTokenBNative) {
                // Call the contract (for LP involving native liquidity)
                result = await swapRouterContract
                  .connect(signer)
                  .addLiquidityETH(
                    isTokenANative
                      ? tokenBContract.address
                      : tokenAContract.address,
                    isStablePool,
                    isTokenANative ? amountTokenBDesired : amountTokenADesired,
                    isTokenANative ? amountTokenBMin : amountTokenAMin,
                    isTokenANative ? amountTokenAMin : amountTokenBMin,
                    signerAddress,
                    deadline,
                    {
                      gasLimit,
                      gasPrice,
                      nonce: nextNonce(),
                      value: isTokenANative
                        ? amountTokenADesired
                        : amountTokenBDesired
                    }
                  )
              } else {
                // Call the contract
                result = await swapRouterContract
                  .connect(signer)
                  .addLiquidity(
                    tokenAContract.address,
                    tokenBContract.address,
                    isStablePool,
                    amountTokenADesired,
                    amountTokenBDesired,
                    amountTokenAMin,
                    amountTokenBMin,
                    signerAddress,
                    deadline,
                    {
                      gasLimit,
                      gasPrice,
                      nonce: nextNonce()
                    }
                  )
                cacheTxMetadata(result.hash, parentCurrencyCode, {
                  name: metadataName,
                  category: 'Expense:Fees',
                  notes: `Provide liquidity for ${metadataLpName} - LP`
                })
              }

              // Cache metadata
              cacheTxMetadata(result.hash, tokenACurrencyCode, {
                name: metadataName,
                category: 'Transfer:Staking',
                notes: `Provide liquidity for ${metadataLpName} - LP`
              })
              cacheTxMetadata(result.hash, tokenBCurrencyCode, {
                name: metadataName,
                category: 'Transfer:Staking',
                notes: `Provide liquidity for ${metadataLpName} - LP`
              })

              //
              // Decode the log data in the receipt to get the liquidity token transfer amount
              //
              const receipt = await result.wait(1)
              const transferTopicHash = ethers.utils.id(
                'Transfer(address,address,uint256)'
              )
              const transferTopics = receipt.logs.filter(
                // @ts-expect-error
                log => log.topics[0] === transferTopicHash
              )
              // The last token transfer log is the LP-token transfer
              const lpTokenTransfer = transferTopics.slice(-1)[0]
              const decodedData = ethers.utils.defaultAbiCoder.decode(
                ['uint256'],
                lpTokenTransfer.data
              )
              const addedLiquidityAmount = decodedData[0].toString()

              return { liquidity: add(addedLiquidityAmount, lpTokenBalance) }
            })(gasLimitAcc('450000'), lpTokenBalance)
        )

        /*
        Staking for LP tokens:
          1. Check if LP staking is still being rewarded
          2. Approve Pool Contract on LP-Contract:
          3. Stake LP token
        */

        const voterAddress = await stakingContract.connect(signer).voter()
        const voterContract = new ethers.Contract(
          voterAddress,
          VELODROME_V2_VOTER,
          signer
        )
        const isAlive = await voterContract
          .connect(signer)
          .isAlive(voterAddress)

        if (isAlive) {
          // 1. Approve Pool Contract on LP-Contract:
          txs.build(
            (gasLimit =>
              async function approveStakingPool({ signer, liquidity }) {
                const spenderAddress = stakingContract.address
                const allowanceResult = await lpTokenContract.allowance(
                  signer.address,
                  spenderAddress
                )
                if (allowanceResult.gte(liquidity)) return

                const approveResult = await lpTokenContract
                  .connect(signer)
                  .approve(spenderAddress, BigNumber.from(liquidity), {
                    gasLimit,
                    gasPrice,
                    nonce: nextNonce()
                  })
                cacheTxMetadata(approveResult.hash, parentCurrencyCode, {
                  name: metadataName,
                  category: 'Expense:Fees',
                  notes: `Approve ${metadataLpName} rewards contract`
                })
              })(gasLimitAcc('100000'))
          )

          // 2. Stake LP token
          txs.build(
            (gasLimit =>
              async function stakeLiquidity({ signer, liquidity }) {
                const result = await stakingContract
                  .connect(signer)
                  ['deposit(uint256)'](liquidity, {
                    gasLimit,
                    gasPrice,
                    nonce: nextNonce()
                  })

                // Amounts need to be calculated here
                cacheTxMetadata(result.hash, parentCurrencyCode, {
                  name: metadataName,
                  category: 'Expense:Fee',
                  notes: `Stake into ${metadataLpName} rewards contract`
                })
              })(gasLimitAcc('240000'))
          )
        }
      }

      //
      // Unstake
      //

      if (action === 'unstake') {
        const lpTokenBalance = (
          await eco.multipass(p =>
            lpTokenContract.connect(p).balanceOf(signerAddress)
          )
        ).toString()

        const tokenAAllocation = allocations.find(
          allocation =>
            allocation.allocationType === action &&
            allocation.currencyCode === tokenACurrencyCode
        )
        const tokenBAllocation = allocations.find(
          allocation =>
            allocation.allocationType === action &&
            allocation.currencyCode === tokenBCurrencyCode
        )

        if (tokenAAllocation == null)
          throw new Error(
            `Contract token ${tokenACurrencyCode} not found in asset pair`
          )
        if (tokenBAllocation == null)
          throw new Error(
            `Contract token ${tokenBCurrencyCode} not found in asset pair`
          )

        // 1. Calculate the liquidity amount (LP-token amount) from the unstake-allocations
        const expectedLiquidityAmount = await getExpectedLiquidityAmount(
          policyInfo,
          tokenAAllocation
        )

        // 2. Check liquidity amount balances
        const stakedLpTokenBalanceResponse = await eco.multipass(p =>
          stakingContract.connect(p).balanceOf(signerAddress)
        )
        const stakedLpTokenBalance = fromHex(stakedLpTokenBalanceResponse._hex)
        const totalLpTokenBalance = add(lpTokenBalance, stakedLpTokenBalance)
        const isBalanceEnough = gte(
          totalLpTokenBalance,
          expectedLiquidityAmount
        )
        if (!isBalanceEnough) {
          showWarning(
            sprintf(lstrings.stake_error_insufficient_s, tokenACurrencyCode),
            { trackError: false }
          )
        }

        // 3. Withdraw LP-token from Pool Contract
        txs.build(
          ((gasLimit, lpTokenBalance) =>
            async function unstakeLiquidity({ signer }) {
              const amountToUnstake = sub(
                expectedLiquidityAmount,
                lpTokenBalance
              )

              // We don't need to unstake liquidity from the pool
              if (lte(amountToUnstake, '0')) return

              const result = await stakingContract
                .connect(signer)
                .withdraw(amountToUnstake, {
                  gasLimit,
                  gasPrice,
                  nonce: nextNonce()
                })
              // Reward transaction metadata
              policyInfo.rewardAssets
                .map(asset => asset.currencyCode)
                .forEach(currencyCode => {
                  cacheTxMetadata(result.hash, currencyCode, {
                    name: metadataName,
                    category: 'Income:Staking',
                    notes: `Claimed rewards from ${metadataLpName}`
                  })
                })
              cacheTxMetadata(result.hash, parentCurrencyCode, {
                name: metadataName,
                category: 'Expense:Fees',
                notes: `Unstake and claim rewards from ${metadataLpName} rewards contract`
              })
            })(gasLimitAcc('240000'), lpTokenBalance)
        )

        // 4. Claim all rewards
        txs.build(
          (gasLimit =>
            async function claimReward({ signer }) {
              const result = await stakingContract
                .connect(signer)
                .getReward(signer.address, {
                  gasLimit,
                  gasPrice,
                  nonce: nextNonce()
                })

              policyInfo.rewardAssets
                .map(asset => asset.currencyCode)
                .forEach(currencyCode => {
                  cacheTxMetadata(result.hash, currencyCode, {
                    name: metadataName,
                    category: 'Income:Staking',
                    notes: `Claimed rewards from ${metadataLpName}`
                  })
                })
              cacheTxMetadata(result.hash, parentCurrencyCode, {
                name: metadataName,
                category: 'Expense:Fees',
                notes: `Claimed rewards from ${metadataLpName}`
              })
            })(gasLimitAcc('240000'))
        )

        // 5. Allow Swap on the LP-token contract
        const spenderAddress = swapRouterContract.address
        txs.build(
          (gasLimit =>
            async function approveSwapRouter({ signer }) {
              const allowanceResult = await lpTokenContract.allowance(
                signer.address,
                spenderAddress
              )
              if (allowanceResult.gte(expectedLiquidityAmount)) return

              const result = await lpTokenContract
                .connect(signer)
                .approve(
                  spenderAddress,
                  BigNumber.from(expectedLiquidityAmount),
                  {
                    gasLimit,
                    gasPrice,
                    nonce: nextNonce()
                  }
                )
              cacheTxMetadata(result.hash, parentCurrencyCode, {
                name: metadataName,
                category: 'Expense:Fees',
                notes: `Approve ${metadataLpName} liquidity pool contract`
              })
            })(gasLimitAcc('100000'))
        )

        // 6. Remove the liquidity from Swap Router contract (using the amount of LP-token withdrawn)
        txs.build(
          (gasLimit =>
            async function removeLiquidity({ signer }) {
              const amountTokenAMin = round(
                mul(tokenAAllocation.nativeAmount, SLIPPAGE_FACTOR.toString())
              )
              const amountTokenBMin = round(
                mul(tokenBAllocation.nativeAmount, SLIPPAGE_FACTOR.toString())
              )
              const deadline = Math.round(Date.now() / 1000) + DEADLINE_OFFSET

              let result
              if (isTokenANative || isTokenBNative) {
                result = await swapRouterContract
                  .connect(signer)
                  .removeLiquidityETH(
                    isTokenANative
                      ? tokenBContract.address
                      : tokenAContract.address,
                    isStablePool,
                    expectedLiquidityAmount,
                    isTokenANative ? amountTokenBMin : amountTokenAMin,
                    isTokenANative ? amountTokenAMin : amountTokenBMin,
                    signerAddress,
                    deadline,
                    {
                      gasLimit,
                      gasPrice,
                      nonce: nextNonce()
                    }
                  )
              } else {
                result = await swapRouterContract
                  .connect(signer)
                  .removeLiquidity(
                    tokenAContract.address,
                    tokenBContract.address,
                    isStablePool,
                    expectedLiquidityAmount,
                    amountTokenAMin,
                    amountTokenBMin,
                    signerAddress,
                    deadline,
                    {
                      gasLimit,
                      gasPrice,
                      nonce: nextNonce()
                    }
                  )
                cacheTxMetadata(result.hash, parentCurrencyCode, {
                  name: metadataName,
                  category: 'Expense:Fees',
                  notes: 'Remove liquidity from ' + metadataLpName + ' - LP'
                })
              }

              cacheTxMetadata(result.hash, tokenACurrencyCode, {
                name: metadataName,
                category: 'Transfer:Staking',
                notes: 'Remove liquidity from ' + metadataLpName + ' - LP'
              })
              cacheTxMetadata(result.hash, tokenBCurrencyCode, {
                name: metadataName,
                category: 'Transfer:Staking',
                notes: 'Remove liquidity from ' + metadataLpName + ' - LP'
              })
            })(gasLimitAcc('500000'))
        )
      }

      //
      // Claim
      //

      if (action === 'claim') {
        // 1. Claim rewards
        txs.build(
          (gasLimit =>
            async function claimReward({ signer }) {
              const result = await stakingContract
                .connect(signer)
                .getReward(signer.address, {
                  gasLimit,
                  gasPrice,
                  nonce: nextNonce()
                })

              policyInfo.rewardAssets
                .map(asset => asset.currencyCode)
                .forEach(currencyCode => {
                  cacheTxMetadata(result.hash, currencyCode, {
                    name: metadataName,
                    category: 'Income:Staking',
                    notes: `Claimed rewards from ${metadataLpName}`
                  })
                })
              cacheTxMetadata(result.hash, parentCurrencyCode, {
                name: metadataName,
                category: 'Expense:Fees',
                notes: `Claimed rewards from ${metadataLpName}`
              })
            })(gasLimitAcc('240000'))
        )
      }

      //
      // Calculate the fees
      //

      // Calculate the networkFee as the gasLimit * gasPrice in the native token
      const networkFee = gasLimitAcc().mul(gasPrice).toString()
      allocations.push({
        allocationType: 'networkFee',
        pluginId: policyInfo.parentPluginId,
        currencyCode: policyInfo.parentCurrencyCode,
        nativeAmount: networkFee
      })

      //
      // Return the quote
      //

      // Construct an approve function which executes transaction workflow (txBuilder)
      const approve: () => Promise<void> = async () => {
        await txs.run()
      }

      return {
        allocations,
        approve
      }
    },
    async fetchStakePosition(
      request: StakePositionRequest
    ): Promise<StakePosition> {
      const { stakePolicyId, wallet, account } = request
      const signerSeed = await account.getDisplayPrivateKey(wallet.id)

      const policyInfo = pluginInfo.policyInfo.find(
        p => p.stakePolicyId === stakePolicyId
      )
      if (policyInfo == null)
        throw new Error(`Stake policy '${stakePolicyId}' not found`)

      const tokenACurrencyCode = policyInfo.stakeAssets[0].currencyCode
      const tokenBCurrencyCode = policyInfo.stakeAssets[1].currencyCode
      const isTokenANative =
        tokenACurrencyCode === policyInfo.parentCurrencyCode
      const isTokenBNative =
        tokenBCurrencyCode === policyInfo.parentCurrencyCode

      // Get the signer for the wallet
      const signerAddress = await eco.makeSigner(signerSeed).getAddress()

      const [
        { stakedLpTokenBalance, assetAmountsFromStakedLp },
        rewardNativeAmount,
        tokenABalance,
        tokenBBalance,
        { lpTokenBalance, assetAmountsFromLp }
      ] = await Promise.all([
        // Get staked allocations:
        // 1. Get the amount of LP-tokens staked in the pool contract
        eco
          .multipass(p => {
            return stakingContract.connect(p).balanceOf(signerAddress)
          })
          .then(async stakedLpTokenBalanceResponse => {
            const stakedLpTokenBalance = stakedLpTokenBalanceResponse.toString()
            // 2. Get the conversion amounts for each stakeAsset using the staked LP-token amount
            const assetAmountsFromStakedLp = await lpTokenToAssetPairAmounts(
              policyInfo,
              stakedLpTokenBalance
            )
            return { stakedLpTokenBalance, assetAmountsFromStakedLp }
          }),
        // Get reward amount:
        eco
          .multipass(p => stakingContract.connect(p).earned(signerAddress))
          .then(String),
        // Get token A balance:
        eco
          .multipass(p =>
            isTokenANative
              ? p.getBalance(signerAddress)
              : tokenAContract.connect(p).balanceOf(signerAddress)
          )
          .then(String),
        // Get token B balance:
        eco
          .multipass(p =>
            isTokenBNative
              ? p.getBalance(signerAddress)
              : tokenBContract.balanceOf(signerAddress)
          )
          .then(String),
        // Get LP token balance:
        eco
          .multipass(p => {
            return lpTokenContract.connect(p).balanceOf(signerAddress)
          })
          .then(async lpTokenBalanceResponse => {
            const lpTokenBalance = lpTokenBalanceResponse.toString()
            // 2. Get the conversion amounts for each stakeAsset using the LP-token amount
            const assetAmountsFromLp = await lpTokenToAssetPairAmounts(
              policyInfo,
              lpTokenBalance
            )
            return { lpTokenBalance, assetAmountsFromLp }
          })
      ])

      // 3. Use the conversion amounts to create the staked allocations
      const stakedAllocations: PositionAllocation[] =
        policyInfo.stakeAssets.map((assetId, index) => {
          const { nativeAmount: stakedNativeAmount } =
            assetAmountsFromStakedLp[serializeAssetId(assetId)]
          const { nativeAmount } = assetAmountsFromLp[serializeAssetId(assetId)]
          if (stakedNativeAmount == null || nativeAmount == null)
            throw new Error(
              `Could not find reserve amount in liquidity pool for ${assetId.currencyCode}`
            )

          return {
            pluginId: assetId.pluginId,
            currencyCode: assetId.currencyCode,
            allocationType: 'staked',
            nativeAmount: add(stakedNativeAmount, nativeAmount),
            locktime: undefined
          }
        })

      // Get earned allocations:
      const earnedAllocations: PositionAllocation[] = [
        {
          pluginId: policyInfo.rewardAssets[0].pluginId,
          currencyCode: policyInfo.rewardAssets[0].currencyCode,
          allocationType: 'earned',
          nativeAmount: rewardNativeAmount,
          locktime: undefined
        }
      ]

      //
      // Actions available for the user:
      //

      // You can stake if you have balances in the paired assets, or some unstaked LP-Token balance
      const canStake =
        !disableStake &&
        ((gt(tokenABalance, '0') && gt(tokenBBalance, '0')) ||
          gt(lpTokenBalance, '0'))

      // You can unstake so long as there is some staked LP-Token balance (there are no timelocks)
      const canUnstakeAndClaim =
        !disableUnstake &&
        (gt(stakedLpTokenBalance, '0') || gt(lpTokenBalance, '0'))

      // You can claim so long as there is some reward balance (there are no timelocks)
      const canClaim = !disableClaim && gt(rewardNativeAmount, '0')

      return {
        allocations: [...stakedAllocations, ...earnedAllocations],
        canStake,
        canUnstake: false,
        canUnstakeAndClaim,
        canClaim
      }
    }
  }

  return instance
}
