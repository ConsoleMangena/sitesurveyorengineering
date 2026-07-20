/**
 * Global context for the open-source embedded Solana wallet.
 *
 * The wallet is unlocked per browser session. Any component can read the
 * current unlocked keypair and use it to sign transactions. The encrypted key
 * is persisted server-side.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useEmbeddedSolanaWallet } from "../lib/solana/useEmbeddedSolanaWallet";
import {
  EmbeddedWalletContext,
  type EmbeddedWalletContextValue,
} from "./EmbeddedWalletContext.ts";

export type { EmbeddedWalletContextValue };

export function EmbeddedWalletProvider({ children }: { children: ReactNode }) {
  const wallet = useEmbeddedSolanaWallet();
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.error) setLastError(wallet.error);
  }, [wallet.error]);

  const createWallet = useCallback(
    async (pin: string) => {
      await wallet.createWallet(pin);
      setLastError(null);
    },
    [wallet],
  );

  const importWallet = useCallback(
    async (mnemonic: string, pin: string) => {
      await wallet.importWallet(mnemonic, pin);
      setLastError(null);
    },
    [wallet],
  );

  const changePin = useCallback(
    async (oldPin: string, newPin: string) => {
      await wallet.changePin(oldPin, newPin);
      setLastError(null);
    },
    [wallet],
  );

  const unlockWallet = useCallback(
    async (pin: string) => {
      await wallet.unlockWallet(pin);
      setLastError(null);
    },
    [wallet],
  );

  const lockWallet = useCallback(() => {
    wallet.lockWallet();
    setLastError(null);
  }, [wallet]);

  const sendTokens = useCallback(
    async (params: { token: "SOL" | "USDC"; recipient: string; amount: number }) => {
      const signature = await wallet.sendTokens(params);
      setLastError(null);
      return signature;
    },
    [wallet],
  );

  const verifyPinForDelete = useCallback(
    async (pin: string) => {
      await wallet.verifyPinForDelete(pin);
      setLastError(null);
    },
    [wallet],
  );

  const deleteWallet = useCallback(async () => {
    await wallet.deleteWallet();
    setLastError(null);
  }, [wallet]);

  const value = useMemo(
    () => ({
      ...wallet,
      error: wallet.error ?? lastError,
      createWallet,
      importWallet,
      changePin,
      unlockWallet,
      lockWallet,
      sendTokens,
      verifyPinForDelete,
      deleteWallet,
    }),
    [
      wallet,
      lastError,
      createWallet,
      importWallet,
      changePin,
      unlockWallet,
      lockWallet,
      sendTokens,
      verifyPinForDelete,
      deleteWallet,
    ],
  );

  return (
    <EmbeddedWalletContext.Provider value={value}>
      {children}
    </EmbeddedWalletContext.Provider>
  );
}

