import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CHAIN, PRIVACY_CHAIN, PROVIDERS, type ProviderId } from "@/config/models";
import { getProviderKey } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Reports which providers have keys, WITHOUT ever returning the keys.
 * The browser only ever learns booleans and labels.
 */
export async function GET() {
  const providers = (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({
    id,
    label: PROVIDERS[id].label,
    note: PROVIDERS[id].note,
    trainsOnYourData: PROVIDERS[id].trainsOnYourData,
    configured: Boolean(getProviderKey(id)),
  }));

  return NextResponse.json({
    ok: true,
    providers,
    defaultChain: DEFAULT_CHAIN.map((t) => ({
      provider: t.provider,
      model: t.model,
      label: t.label,
      supportsImages: t.supportsImages,
      supportsPdfNative: t.supportsPdfNative,
    })),
    privacyChain: PRIVACY_CHAIN.map((t) => ({
      provider: t.provider,
      model: t.model,
      label: t.label,
    })),
    passcodeRequired: Boolean(process.env.APP_PASSCODE?.trim()),
  });
}
