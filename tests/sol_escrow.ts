import * as anchor from "@project-serum/anchor";
import { Wallet, Program } from "@project-serum/anchor";
import { SolEscrow } from "../target/types/sol_escrow";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  createAssociatedTokenAccount,
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

  // Setting up accounts.
  const alice = anchor.web3.Keypair.generate();
  const bob = anchor.web3.Keypair.generate();
  const tempTokenXAccount = anchor.web3.Keypair.generate();
  const escrowAccount = anchor.web3.Keypair.generate();
  const rent = anchor.web3.SYSVAR_RENT_PUBKEY;
  const systemProgram = anchor.web3.SystemProgram.programId;

  it("Initialize and process exchange", async () => {

    // Creating mints X and Y.
    const mintX = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      1,
      anchor.web3.Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );
    const mintY = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      1,
      anchor.web3.Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );

    // Configuring Alice's token accounts and info.
    const aliceTokenXAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintX,
      alice.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const aliceTokenYAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintY,
      alice.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const aliceAmountToReceive = 200;

    // Configuring Bob's token accounts and info.
    const bobTokenXAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintX,
      bob.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const bobTokenYAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintY,
      bob.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const bobAmountToReceive = 400;

    // Sending the amounts of tokens needed in the tx to Alice and Bob.
    await mintTo(
      provider.connection,
      wallet.payer,
      mintX,
      aliceTokenXAccount,
      wallet.publicKey,
      Number(bobAmountToReceive),
      [wallet.payer],
      null,
      TOKEN_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      wallet.payer,
      mintY,
      bobTokenYAccount,
      wallet.publicKey,
      Number(aliceAmountToReceive),
      [wallet.payer],
      null,
      TOKEN_PROGRAM_ID
    );

    // Getting PDA account and bump.
    const [pda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      program.programId
    );

    // Funding both parties' main accounts.
    let airdropToAlice = await provider.connection.requestAirdrop(
      alice.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    let airdropToBob = await provider.connection.requestAirdrop(
      bob.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    let { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: airdropToAlice
    });
    await provider.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: airdropToBob
    });

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
        tempTokenXAccount: tempTokenXAccount.publicKey,
        aliceTokenYAccount: aliceTokenYAccount,
        escrowAccount: escrowAccount.publicKey,
        mintX: mintX,
        rent: rent,
        pda: pda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: systemProgram
      })
      .signers(
        [alice, tempTokenXAccount, escrowAccount]
      )
      .rpc()
    ;

    // Get temporary token account's info.
    let tempTokenXAccountInfo = await getAccount(
      provider.connection,
      tempTokenXAccount.publicKey,
      "processed",
      TOKEN_PROGRAM_ID
    );

    //Check that the correct amount of tokens is transferred from Alice to the temporary account.
    assert.equal(
      tempTokenXAccountInfo.amount,
      new anchor.BN(bobAmountToReceive)
    );

    // Check that the escrow account's fields are populated correctly.
    let populatedEscrowAccount = await program.account.escrow.fetch(escrowAccount.publicKey);
    assert.equal(
      (await populatedEscrowAccount).aliceKey.toBase58(),
      alice.publicKey.toBase58()
    );
    assert.equal(
      (await populatedEscrowAccount).aliceTokenXAccount.toBase58(),
      aliceTokenXAccount.toBase58()
    );
    assert.equal(
      (await populatedEscrowAccount).aliceTokenYAccount.toBase58(),
      aliceTokenYAccount.toBase58()
    );
    assert.equal(
      (await populatedEscrowAccount).aliceAmountToReceive.toNumber(),
      aliceAmountToReceive
    );
    assert.equal(
      (await populatedEscrowAccount).bobAmountToReceive.toNumber(),
      bobAmountToReceive
    );

    // Process exchange.
    await program
      .methods
      .processExchange(bump)
      .accounts({
        bobAccount: bob.publicKey,
        bobTokenYAccount: bobTokenYAccount,
        bobTokenXAccount: bobTokenXAccount,
        tempTokenXAccount: tempTokenXAccount.publicKey,
        pda: pda,
        aliceAccount: alice.publicKey,
        aliceTokenYAccount: aliceTokenYAccount,
        escrowAccount: escrowAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: systemProgram
      })
      .signers(
        [bob]
      )
      .rpc()
    ;

    // Check that Bob received the right amount of tokens.
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

    // Check that Alice received the right amount of tokens.
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
    const mintX = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      1,
      anchor.web3.Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );
    const mintY = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      1,
      anchor.web3.Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );

    // Configuring Alice's token accounts and info.
    const aliceTokenXAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintX,
      alice.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const aliceTokenYAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintY,
      alice.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const aliceAmountToReceive = 200;

    // Configuring Bob's token accounts and info.
    const bobTokenXAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintX,
      bob.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const bobTokenYAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mintY,
      bob.publicKey,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const bobAmountToReceive = 400;

    // Sending the amounts of tokens needed in the tx to Alice and Bob.
    await mintTo(
      provider.connection,
      wallet.payer,
      mintX,
      aliceTokenXAccount,
      wallet.publicKey,
      Number(bobAmountToReceive),
      [wallet.payer],
      null,
      TOKEN_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      wallet.payer,
      mintY,
      bobTokenYAccount,
      wallet.publicKey,
      Number(aliceAmountToReceive),
      [wallet.payer],
      null,
      TOKEN_PROGRAM_ID
    );

    // Getting PDA account and bump.
    const [pda, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      program.programId
    );

    // Funding both parties' main accounts.
    let airdropToAlice = await provider.connection.requestAirdrop(
      alice.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    let airdropToBob = await provider.connection.requestAirdrop(
      bob.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    let { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: airdropToAlice
    });
    await provider.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature: airdropToBob
    });

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
        tempTokenXAccount: tempTokenXAccount.publicKey,
        aliceTokenYAccount: aliceTokenYAccount,
        escrowAccount: escrowAccount.publicKey,
        mintX: mintX,
        rent: rent,
        pda: pda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: systemProgram
      })
      .signers(
        [alice, tempTokenXAccount, escrowAccount]
      )
      .rpc()
    ;

    // Get temporary token account's and Alice's token account's infos.
    let tempTokenXAccountInfo = await getAccount(
      provider.connection,
      tempTokenXAccount.publicKey,
      "processed",
      TOKEN_PROGRAM_ID
    );
    let aliceTokenXAccountInfo = await getAccount(
      provider.connection,
      aliceTokenXAccount,
      "processed",
      TOKEN_PROGRAM_ID
    );

    // Check that the tokens have been transferred from Alice to the temp account.
    assert.equal(
      tempTokenXAccountInfo.amount,
      new anchor.BN(bobAmountToReceive)
    );
    assert.equal(
      aliceTokenXAccountInfo.amount,
      new anchor.BN(0)
    );

    // Cancel exchange.
    await program
      .methods
      .cancel(bump)
      .accounts({
        aliceAccount: alice.publicKey,
        aliceTokenXAccount: aliceTokenXAccount,
        tempTokenXAccount: tempTokenXAccount.publicKey,
        pda: pda,
        escrowAccount: escrowAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([alice])
      .rpc()
    ;

    // Check that the tokens have been transferred back to Alice.
    aliceTokenXAccountInfo = await getAccount(
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
