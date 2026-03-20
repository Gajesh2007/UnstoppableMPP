import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Live platform statistics for UnstoppableMPP — transactions, tokens processed, volume, active sellers, API keys, and Codex tokens. Updates every 5 seconds.",
  openGraph: {
    title: "Explore | UnstoppableMPP",
    description:
      "Live platform statistics — transactions, tokens, volume, and seller activity on the decentralized API marketplace.",
  },
};

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
