import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { Onboarding } from "./Onboarding";

test("steps through all 4 screens and calls onComplete", () => {
  const onComplete = vi.fn();
  render(<Onboarding onComplete={onComplete} />);
  expect(screen.getByText(/chunking/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText(/forking/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText(/backtracking/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText(/graph view/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(onComplete).toHaveBeenCalled();
});

test("skip calls onComplete immediately", () => {
  const onComplete = vi.fn();
  render(<Onboarding onComplete={onComplete} />);
  fireEvent.click(screen.getByText("Skip"));
  expect(onComplete).toHaveBeenCalled();
});
