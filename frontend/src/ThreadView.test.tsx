import { render, screen } from "@testing-library/react";
import { vi, test, expect } from "vitest";
import { ThreadView } from "./ThreadView";
import * as api from "./api";

test("renders chunks returned by getThread", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    chunks: [{ id: "t1#c0", kind: "block", order: 0, text: "Hello world" }],
  } as any);
  render(<ThreadView threadId="t1" />);
  expect(await screen.findByText("Hello world")).toBeInTheDocument();
});
