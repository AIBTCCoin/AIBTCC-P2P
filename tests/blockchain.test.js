/*const assert = require("assert");
const { Blockchain, Transaction } = require("../src/blockchain");
const {
  createSignedTx,
  signingKey,
  createBlockchainWithTx,
  createBCWithMined,
} = require("./helpers");

const EC = require('elliptic').ec;

const ec = new EC('secp256k1');

let blockchain = null;

beforeEach(async function () {
  blockchain = new Blockchain();
  await blockchain.minePendingTransactions(signingKey.getPublic("hex"));
});

describe("Blockchain class", function () {
  beforeEach(async function () {
    blockchain = new Blockchain();
    await blockchain.minePendingTransactions(signingKey.getPublic("hex"));
  });

  describe("Constructor", function () {
    it("should properly initialize fields", function () {
      assert.strictEqual(blockchain.difficulty, 0);
      assert.deepStrictEqual(blockchain.pendingTransactions, []);
      assert.strictEqual(blockchain.miningReward, 100);
    });
  });

  describe("addTransaction", function () {
    this.timeout(10000); 
    it("should correctly add new tx", function () {
      const tx = createSignedTx(); // Assuming createSignedTx() creates a valid signed transaction
      blockchain.addTransaction(tx);
      console.log("Pending Transactions:", blockchain.pendingTransactions); // Debugging line
      assert.strictEqual(blockchain.pendingTransactions.length, 1);
      assert.strictEqual(blockchain.pendingTransactions[0], tx);
    });

    it("should fail for tx without from address", function () {
      const validTx = createSignedTx();
      validTx.fromAddress = null;
      assert.throws(() => {
        blockchain.addTransaction(validTx);
      }, Error);
    });

    it("should fail for tx without to address", function () {
      const validTx = createSignedTx();
      validTx.toAddress = null;
      assert.throws(() => {
        blockchain.addTransaction(validTx);
      }, Error);
    });

    it("should fail when tx is not valid", function () {
      const validTx = createSignedTx();
      validTx.amount = 1000;
      assert.throws(() => {
        blockchain.addTransaction(validTx);
      }, Error);
    });

    it("should fail when tx has negative or zero amount", function () {
      assert.throws(() => {
        createSignedTx(0);
      }, /Amount must be positive/);
      assert.throws(() => {
        createSignedTx(-20);
      }, /Amount must be positive/);
    });

    it("should fail when not having enough balance", async function () {
      const blockchain = new Blockchain();
      const walletAddress = signingKey.getPublic("hex");
      await blockchain.minePendingTransactions(walletAddress);

      const tx = new Transaction(walletAddress, "recipientAddress", 150);
      tx.sign(signingKey);

      const result = blockchain.addTransaction(tx);
      assert.strictEqual(result, false);
    });
  });

  describe("wallet balance", function () {
    this.timeout(10000);
    it("should give mining rewards", function () {
      const balance = blockchain.getBalanceOfAddress(
        signingKey.getPublic("hex")
      );
      assert.strictEqual(balance, 100);
    });

    describe("wallet balance", function () {
      it("should correctly reduce wallet balance", async function () {
        const walletAddress = signingKey.getPublic("hex");
    
        // Mine the initial block to get the mining reward
        await blockchain.minePendingTransactions(walletAddress);
    
        // Check initial balance after first mining reward
        const initialBalance = blockchain.getBalanceOfAddress(walletAddress);
        console.log(`Initial balance: ${initialBalance}`);  // Should be the mining reward, e.g., 100
    
        // Create and add a transaction
        const tx = new Transaction(walletAddress, "recipientAddress", 100);
        tx.sign(signingKey);
        blockchain.addTransaction(tx);
    
        // Mine another block to process the transaction and receive another mining reward
        await blockchain.minePendingTransactions(walletAddress);
    
        // Check the final balance after the transaction and the second mining reward
        const finalBalance = blockchain.getBalanceOfAddress(walletAddress);
        console.log(`Final balance: ${finalBalance}`);
    
        // Calculate expected balance
        const expectedFinalBalance = initialBalance - 100 + blockchain.miningReward;
        assert.strictEqual(finalBalance, expectedFinalBalance);
      });
    });

    it("should work with cyclic transactions", async function () {
      const walletAddress1 = signingKey.getPublic("hex");
      const signingKey2 = ec.genKeyPair();
      const walletAddress2 = signingKey2.getPublic("hex");
    
      console.log('Initial Balances:', blockchain.getBalanceOfAddress(walletAddress1), blockchain.getBalanceOfAddress(walletAddress2));
    
      const tx1 = new Transaction(walletAddress1, walletAddress2, 50);
      tx1.sign(signingKey);
      blockchain.addTransaction(tx1);
      await blockchain.minePendingTransactions(walletAddress1); // Correct miner reward
      
      console.log('Balances after tx1:', blockchain.getBalanceOfAddress(walletAddress1), blockchain.getBalanceOfAddress(walletAddress2));
    
      const tx2 = new Transaction(walletAddress2, walletAddress1, 30);
      tx2.sign(signingKey2);
      blockchain.addTransaction(tx2);
      await blockchain.minePendingTransactions(walletAddress2); // Correct miner reward
    
      console.log('Balances after tx2:', blockchain.getBalanceOfAddress(walletAddress1), blockchain.getBalanceOfAddress(walletAddress2));
    
      const balance1 = blockchain.getBalanceOfAddress(walletAddress1);
      const balance2 = blockchain.getBalanceOfAddress(walletAddress2);
    
      assert.strictEqual(balance1, 180); // After considering all transactions and mining rewards
      assert.strictEqual(balance2, 120); // After considering all transactions and mining rewards
    });
    
    

    it("should not allow pending transactions to go below zero", () => {
      const blockchain = new Blockchain();
      const walletAddress = "walletAddress1";
      const tx1 = new Transaction(walletAddress, "recipientAddress", -10);
      assert.throws(
        () => {
          blockchain.addTransaction(tx1);
        },
        Error,
        "Transaction amount should be greater than 0."
      );
    });
  });

  describe("helper functions", function () {
    this.timeout(10000); 
    it("should correctly set first block to genesis block", function () {
      assert.strictEqual(blockchain.chain[0].index, 0);
      assert.strictEqual(blockchain.chain[0].previousHash, "0");
    });
  });

  describe("isChainValid", function () {
    it("should fail when genesis block has been tampered with", function () {
      blockchain.chain[0].hash = "tampered_hash";
      assert.strictEqual(blockchain.isChainValid(), false);
    });

    it("should fail when a tx is invalid", function () {
      const invalidTx = createSignedTx({ amount: -10 });
      blockchain.chain[1].transactions.push(invalidTx);
      assert.strictEqual(blockchain.isChainValid(), false);
    });
  });
});
*/