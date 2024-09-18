const { Transaction, Blockchain } = require('../src/blockchain');
const EC = require('elliptic').ec;

const ec = new EC('secp256k1');

const keyPair = ec.genKeyPair();
const publicKey = keyPair.getPublic('hex');

function createSignedTx(amount = 10, toAddress = 'b2') {
  if (amount <= 0) throw new Error('Amount must be positive');

  const tx = new Transaction(publicKey, toAddress, amount);
  tx.timestamp = Date.now();
  tx.sign(keyPair);

  return tx;
}


async function createBlockchainWithTx() {
  const blockchain = new Blockchain();
  const tx = createSignedTx(50);
  blockchain.addTransaction(tx);
  await blockchain.minePendingTransactions('miner-address');
  return blockchain;
}

async function createBCWithMined() {
  const blockchain = new Blockchain();
  await blockchain.minePendingTransactions('miner-address');
  return blockchain;
}

module.exports = {
  createSignedTx,
  createBlockchainWithTx,
  createBCWithMined,
  signingKey: keyPair
};










