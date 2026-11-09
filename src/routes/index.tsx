import { createFileRoute } from "@tanstack/react-router";
import { Reader } from "@/components/quire/reader";

export const Route = createFileRoute("/")({
  component: Reader,
});
