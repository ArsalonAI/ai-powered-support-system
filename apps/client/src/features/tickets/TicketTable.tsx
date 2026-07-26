import type { TicketSummary } from '@support/shared';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Link } from 'react-router';
import { CategoryBadge, StatusBadge, WaitingOnBadge } from './badges';

/**
 * Filtering, sorting, and pagination are all server-side — the endpoint owns
 * them, and the seeded corpus is deliberately deep enough that paging is real
 * rather than simulated. So the table runs in manual mode and contributes the
 * column definitions and rendering only.
 */
const columnHelper = createColumnHelper<TicketSummary>();

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

const columns = [
  columnHelper.accessor('number', {
    header: '#',
    cell: (info) => <span className="tabular-nums text-slate-500">{info.getValue()}</span>,
  }),
  columnHelper.accessor('subject', {
    header: 'Subject',
    cell: (info) => (
      <Link
        to={`/tickets/${info.row.original.number}`}
        className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor((row) => row.customer.displayName ?? row.customer.email, {
    id: 'customer',
    header: 'Customer',
    cell: (info) => <span className="text-slate-600">{info.getValue()}</span>,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor('waitingOn', {
    header: 'Waiting on',
    cell: (info) => <WaitingOnBadge waitingOn={info.getValue()} />,
  }),
  columnHelper.accessor('category', {
    header: 'Category',
    cell: (info) => (
      <CategoryBadge
        category={info.getValue()}
        classificationState={info.row.original.classificationState}
      />
    ),
  }),
  columnHelper.accessor('assignee', {
    header: 'Assignee',
    cell: (info) => (
      <span className="text-slate-600">
        {info.getValue()?.name ?? <em className="text-slate-400">unclaimed</em>}
      </span>
    ),
  }),
  columnHelper.accessor('createdAt', {
    header: 'Age',
    cell: (info) => (
      <span className="whitespace-nowrap text-slate-500">{age(info.getValue())}</span>
    ),
  }),
];

export function TicketTable({ tickets }: { tickets: TicketSummary[] }) {
  const table = useReactTable({
    data: tickets,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  if (tickets.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        No tickets match these filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} scope="col" className="px-3 py-2 font-medium text-slate-600">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
