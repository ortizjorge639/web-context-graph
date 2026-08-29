import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { Onboarding } from "./Onboarding";

test("travels through all tutorial cards and calls onComplete", async () => {
  const onComplete = vi.fn();
  render(<Onboarding onComplete={onComplete} finaleDuration={0} handoffDuration={0} />);
  expect(screen.getByText("Lineage App")).toBeInTheDocument();
  expect(screen.getByText("Think in branches.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Branch from this chunk" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Show me how"));
  expect(screen.getByText("Every idea has an address.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Branch from this chunk" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText("Follow the interesting path.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText("Return without starting over.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText("See the shape of your thinking.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Create my graph"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ animated: true }));
});

test("skip calls onComplete immediately", async () => {
  const onComplete = vi.fn();
  render(<Onboarding onComplete={onComplete} />);
  fireEvent.click(screen.getByText("Skip tutorial"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ animated: false }));
});

test("removes the handoff overlay and exposes the error when setup fails", async () => {
  const onComplete = vi.fn().mockRejectedValue(new Error("Backend unavailable"));
  render(<Onboarding onComplete={onComplete} finaleDuration={0} handoffDuration={0} />);

  fireEvent.click(screen.getByText("Show me how"));
  fireEvent.click(screen.getByText("Next"));
  fireEvent.click(screen.getByText("Next"));
  fireEvent.click(screen.getByText("Next"));
  fireEvent.click(screen.getByText("Create my graph"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Backend unavailable");
  expect(screen.queryByText("Preparing your workspace")).not.toBeInTheDocument();
});
