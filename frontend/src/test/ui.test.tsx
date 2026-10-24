import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, EmptyState, ErrorState, Pagination, StatusBadge, ToastProvider } from "../components/ui";

describe("EmptyState", () => {
  it("renders title and hint", () => {
    render(<EmptyState title="No records found" hint="Try adjusting filters" />);
    expect(screen.getByText("No records found")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting filters")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("shows message and invokes retry", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Boom failed" onRetry={onRetry} />);
    expect(screen.getByText("Boom failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("DataTable", () => {
  const columns = [{ header: "Name", render: (r: { name: string }) => r.name }];
  it("shows empty state when no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.name} emptyTitle="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
  it("renders rows and supports row click", async () => {
    const onClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ name: "Alpha" }, { name: "Beta" }]}
        rowKey={(r) => r.name}
        onRowClick={onClick}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Alpha"));
    expect(onClick).toHaveBeenCalledWith({ name: "Alpha" });
  });
  it("shows error state with message", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.name} error="Failed to load" />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders labelised value", () => {
    render(<StatusBadge value="awaiting_clearance" />);
    expect(screen.getByText("Awaiting Clearance")).toBeInTheDocument();
  });
  it("renders dash for empty", () => {
    render(<StatusBadge value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  it("disables previous on first page and advances", async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pages={3} total={30} onPage={onPage} />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe("ToastProvider", () => {
  it("renders without crashing", () => {
    render(
      <ToastProvider>
        <div>child</div>
      </ToastProvider>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
