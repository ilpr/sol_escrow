import * as anchor from "@project-serum/anchor";
import { Program, Wallet } from "@project-serum/anchor";
import { SolEscrow } from "../target/types/sol_escrow";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount
} from '@solana/spl-token'
import * as assert from "assert";
const { LAMPORTS_PER_SOL } = require("@solana/web3.js")

describe("Escrow test", () => {

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  const wallet = provider.wallet as Wallet;
  anchor.setProvider(provider);
  const program = anchor.workspace.SolEscrow as Program<SolEscrow>

  // Set up constant accounts.
  const alice = anchor.web3.Keypair.generate();
  const bob = anchor.web3.Keypair.generate();
  const rent = anchor.web3.SYSVAR_RENT_PUBKEY;
  const systemProgram = anchor.web3.SystemProgram.programId;

  // Other info.
  const aliceAmountToReceive = 200;
  const bobAmountToReceive = 400;
  const escrowSeeds = "sol_escrow";

  // Functions.
  async function newMint() {
    return await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0,
      anchor.web3.Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );
  }
  async function createTokenAccount(
    mint: anchor.web3.PublicKey,
    pubKey: anchor.web3.PublicKey
    ) {
    let tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      pubKey,
      false,
      "processed",
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return tokenAccount.address;
  }
  async function mintTokens(
    mint,
    tokenAccount,
    amountToReceive
    ) {
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      tokenAccount,
      wallet.publicKey,
      amountToReceive,
      [wallet.payer],
      null,
      TOKEN_PROGRAM_ID
    );
  }

  it("Initialize and finalise exchange", async () => {

    // Funding both parties' main accounts.
    let { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: await provider.connection.requestAirdrop(
        alice.publicKey,
        5 * LAMPORTS_PER_SOL
      )
    });
    await provider.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: await
      provider.connection.requestAirdrop(
        bob.publicKey,
        5 * LAMPORTS_PER_SOL
      )
    });

    // Creating mints X and Y.
    const mintX = await newMint();
    const mintY = await newMint();

    // Configuring Alice's token accounts.
    const aliceTokenXAccount = await createTokenAccount(mintX, alice.publicKey);
    const aliceTokenYAccount = await createTokenAccount(mintY, alice.publicKey);

    // Configuring Bob's token accounts.
    const bobTokenXAccount = await createTokenAccount(mintX, bob.publicKey);
    const bobTokenYAccount = await createTokenAccount(mintY, bob.publicKey);

    // Sending the amounts of tokens needed in the tx to Alice and Bob.
    await mintTokens(mintX, aliceTokenXAccount, bobAmountToReceive);
    await mintTokens(mintY, bobTokenYAccount, aliceAmountToReceive);

    // Getting PDA and bump for the escrow account.
    let [vaultAuthority, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(escrowSeeds)],
      program.programId
    );

    // Getting address for escrow account.
    const escrowAccount = anchor.web3.Keypair.generate();

    // Get keypair for temporary token account.
    const mintXVault = anchor.web3.Keypair.generate();

    // Initialize escrow.
    await program
      .methods
      .initEscrow(
        new anchor.BN(aliceAmountToReceive),
        new anchor.BN(bobAmountToReceive),
        bump
      )
      .accounts({
        aliceAccount: alice.publicKey,
        aliceTokenXAccount: aliceTokenXAccount,
        mintX: mintX,
        mintY: mintY,
        mintXVault: mintXVault.publicKey,
        vaultAuthority: vaultAuthority,
        escrowAccount: escrowAccount.publicKey,
        rent: rent,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: systemProgram
      })
      .signers(
        [alice, mintXVault, escrowAccount]
      )
      .rpc()
    ;

    // Assert that the correct amount of tokens is transferred from Alice to the temporary account.
    let mintXVaultInfo = await getAccount(
      provider.connection,
      mintXVault.publicKey,
      "processed",
      TOKEN_PROGRAM_ID
    );
    assert.equal(
      mintXVaultInfo.amount,
      new anchor.BN(bobAmountToReceive)
    );

    // Assert that the escrow account's fields are populated correctly.
    let populatedEscrowAccount = await program.account.escrow.fetch(escrowAccount.publicKey);
    assert.equal(
      populatedEscrowAccount.aliceKey.toBase58(),
      alice.publicKey.toBase58()
    );
    assert.equal(
      populatedEscrowAccount.mintXVault.toBase58(),
      mintXVault.publicKey.toBase58()
    );
    assert.equal(
      populatedEscrowAccount.aliceAmountToReceive.toNumber(),
      aliceAmountToReceive
    );
    assert.equal(
      populatedEscrowAccount.bobAmountToReceive.toNumber(),
      bobAmountToReceive
    );

    // Process exchange.
    await program
      .methods
      .processExchange()
      .accounts({
        bobAccount: bob.publicKey,
        bobTokenYAccount: bobTokenYAccount,
        bobTokenXAccount: bobTokenXAccount,
        mintXVault: mintXVault.publicKey,
        vaultAuthority: vaultAuthority,
        aliceAccount: alice.publicKey,
        aliceTokenYAccount: aliceTokenYAccount,
        escrowAccount: escrowAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers(
        [bob]
      )
      .rpc()
    ;

    // Assert that Bob and Alice received the right amount of tokens.
    let bobTokenXAccountInfo = await getAccount(
      provider.connection,
      bobTokenXAccount,
      "processed",
      TOKEN_PROGRAM_ID
    );
    assert.equal(
      bobTokenXAccountInfo.amount,
      new anchor.BN(bobAmountToReceive)
    );
    let aliceTokenYAccountInfo = await getAccount(
      provider.connection,
      aliceTokenYAccount,
      "processed",
      TOKEN_PROGRAM_ID
    );
    assert.equal(
      aliceTokenYAccountInfo.amount,
      new anchor.BN(aliceAmountToReceive)
    );
  });

  it("Initialize and cancel exchange", async () => {

    // Creating mints X and Y.
    const mintX = await newMint();
    const mintY = await newMint();

    // Configuring Alice's token X account.
    const aliceTokenXAccount = await createTokenAccount(mintX, alice.publicKey);

    // Sending the amounts of tokens needed in the tx to Alice.
    await mintTokens(mintX, aliceTokenXAccount, bobAmountToReceive);

    // Getting PDA and bump for the escrow account.
    let [vaultAuthority, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(escrowSeeds)],
      program.programId
    );

    // Getting address for escrow account.
    const escrowAccount = anchor.web3.Keypair.generate();

    // Get keypair for temporary token account.
    const mintXVault = anchor.web3.Keypair.generate();

    // Initialize escrow.
    await program
      .methods
      .initEscrow(
        new anchor.BN(aliceAmountToReceive),
        new anchor.BN(bobAmountToReceive),
        bump
      )
      .accounts({
        aliceAccount: alice.publicKey,
        aliceTokenXAccount: aliceTokenXAccount,
        mintX: mintX,
        mintY: mintY,
        mintXVault: mintXVault.publicKey,
        vaultAuthority: vaultAuthority,
        escrowAccount: escrowAccount.publicKey,
        rent: rent,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: systemProgram
      })
      .signers(
        [alice, mintXVault, escrowAccount]
      )
      .rpc()
    ;

    // Assert that the correct amount of tokens is transferred from Alice to the temporary account.
    let mintXVaultInfo = await getAccount(
      provider.connection,
      mintXVault.publicKey,
      "processed",
      TOKEN_PROGRAM_ID
    );
    assert.equal(
      mintXVaultInfo.amount,
      new anchor.BN(bobAmountToReceive)
    );

    // Cancel exchange.
    await program
      .methods
      .cancel()
      .accounts({
        aliceAccount: alice.publicKey,
        aliceTokenXAccount: aliceTokenXAccount,
        mintXVault: mintXVault.publicKey,
        vaultAuthority: vaultAuthority,
        escrowAccount: escrowAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([alice])
      .rpc()
    ;

    // Assert that the tokens have been transferred back to Alice.
    let aliceTokenXAccountInfo = await getAccount(
      provider.connection,
      aliceTokenXAccount,
      "processed",
      TOKEN_PROGRAM_ID
    );
    assert.equal(
      aliceTokenXAccountInfo.amount,
      new anchor.BN(bobAmountToReceive)
    );
  });
});
