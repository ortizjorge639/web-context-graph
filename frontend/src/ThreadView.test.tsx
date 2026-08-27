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

test("reasoning trace is collapsed by default and expands on click", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    chunks: [
      { id: "t1#c0", kind: "block", order: 0, text: "Hello", trace: ["step one", "step two"] },
    ],
  } as any);
  render(<ThreadView threadId="t1" />);
  expect(await screen.findByText("2 steps")).toBeInTheDocument();
  expect(screen.queryByText("step one")).not.toBeInTheDocument();
  screen.getByText("2 steps").click();
  expect(await screen.findByText("step one")).toBeInTheDocument();
});
