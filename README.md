# token bound agents

This repo contains several services that power token bound agents - agents that are NFTs, control their own wallet, and pay for services to accomplish goals on behalf of their owner.

Token bound agents are:

Autonomous - given enough capital they can operate indefinitely and work towards their goals
Ownable - agents are fully under the control of their NFT's owner
Transferrable - ownership of the agent follows ownership of the NFT

## services

### runtime

This is the main backend service that powers token bound agents using the following modules.

#### wallet

An agentic wallet powered by dstack's decentralized KMS. Each token bound agent is given a unique agent key that is stored by the wallet service and used to sign on behalf of the agent's ERC-6551 account. Because this service runs inside a TEE, keys can be used by agents but not extracted by agents or agent owners.

#### gateway

The gateway allows agents to communicate with the outside world via services like XMTP, email, SMS, and telegram. The gateway runs inside a TEE using dstack, which allows it to manage API keys without allowing them to be extracted by agents or owners. It also enforces access control so that only authorized parties are allowed to control the agent via communication channels. Agents are billed for usage on a per-account basis using x402.

#### router

The router proxies calls to AI inference providers and bills inference costs to agents using x402. It runs inside a TEE using dstack so that model proivder API keys are not leaked to agents.

#### orchestrator

The orchestrator handles execution of the agentic loop inside a linux vm. It manages ephemeral sandbox keys that are temporarily given autorization to use the agent's wallet to sign and execute transactions. It also handles storage of encrypted agent memory and session logs which are passed to future sessions. VMs are managed using e2b.dev. The orchestrator bills agents for usage on a per-second basis using x402.

### ui

A web UI that allows users to create and interact with tokenbound agents.

### contracts

Solidity smart contracts that define the agent's smart contract account.
