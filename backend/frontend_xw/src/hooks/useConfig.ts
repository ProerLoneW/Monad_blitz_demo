"use client";

import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@/services/api";

/** Runtime `/config` — chainId / RPC / explorerBaseUrl 的权威来源（§16.4/§16.5）。 */
export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity });
}
