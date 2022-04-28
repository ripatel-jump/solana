import React from "react";
import { Link, useHistory, useLocation } from "react-router-dom";
import { Location } from "history";
import {
  BlockResponse,
  ConfirmedTransactionMeta,
  TransactionSignature,
  PublicKey,
  VOTE_PROGRAM_ID,
} from "@solana/web3.js";
import { ErrorCard } from "components/common/ErrorCard";
import { Signature } from "components/common/Signature";
import { Address } from "components/common/Address";
import { pickClusterParams, useQuery } from "utils/url";
import { useCluster } from "providers/cluster";
import { displayAddress } from "utils/tx";
import { parseProgramLogs } from "utils/program-logs";

const PAGE_SIZE = 25;

const useQueryFilter = (query: URLSearchParams): string => {
  const filter = query.get("filter");
  return filter || "";
};

type SortMode = "index" | "compute";
const useQuerySort = (query: URLSearchParams): SortMode => {
  const sort = query.get("sort");
  if (sort === "compute") return "compute";
  return "index";
};

type TransactionWithInvocations = {
  index: number;
  signature?: TransactionSignature;
  meta: ConfirmedTransactionMeta | null;
  invocations: Map<string, number>;
  computeUnits: number;
  logTruncated: boolean;
};

export function BlockHistoryCard({ block }: { block: BlockResponse }) {
  const [numDisplayed, setNumDisplayed] = React.useState(PAGE_SIZE);
  const [showDropdown, setDropdown] = React.useState(false);
  const query = useQuery();
  const filter = useQueryFilter(query);
  const sortMode = useQuerySort(query);
  const { cluster } = useCluster();
  const location = useLocation();
  const history = useHistory();

  const { transactions, invokedPrograms } = React.useMemo(() => {
    const invokedPrograms = new Map<string, number>();

    const transactions: TransactionWithInvocations[] = block.transactions.map(
      (tx, index) => {
        let signature: TransactionSignature | undefined;
        if (tx.transaction.signatures.length > 0) {
          signature = tx.transaction.signatures[0];
        }

        let programIndexes = tx.transaction.message.instructions
          .map((ix) => ix.programIdIndex)
          .concat(
            tx.meta?.innerInstructions?.flatMap((ix) => {
              return ix.instructions.map((ix) => ix.programIdIndex);
            }) || []
          );

        const indexMap = new Map<number, number>();
        programIndexes.forEach((programIndex) => {
          const count = indexMap.get(programIndex) || 0;
          indexMap.set(programIndex, count + 1);
        });

        const invocations = new Map<string, number>();
        for (const [i, count] of indexMap.entries()) {
          const programId = tx.transaction.message.accountKeys[i].toBase58();
          invocations.set(programId, count);
          const programTransactionCount = invokedPrograms.get(programId) || 0;
          invokedPrograms.set(programId, programTransactionCount + 1);
        }

        const parsedLogs = parseProgramLogs(
          tx.meta?.logMessages ?? [],
          tx.meta?.err ?? null,
          cluster
        );

        const logTruncated = parsedLogs[parsedLogs.length - 1].truncated;
        const computeUnits = parsedLogs
          .map(({ computeUnits }) => computeUnits)
          .reduce((sum, next) => sum + next);

        return {
          index,
          signature,
          meta: tx.meta,
          invocations,
          computeUnits,
          logTruncated,
        };
      }
    );
    return { transactions, invokedPrograms };
  }, [block, cluster]);

  const filteredTransactions = React.useMemo(() => {
    const voteFilter = VOTE_PROGRAM_ID.toBase58();
    const filteredTxs = transactions.filter(({ invocations }) => {
      if (filter === ALL_TRANSACTIONS) {
        return true;
      } else if (filter === HIDE_VOTES) {
        // hide vote txs that don't invoke any other programs
        return !(invocations.size === 1 || invocations.has(voteFilter));
      }
      return invocations.has(filter);
    });

    if (sortMode === "compute") {
      filteredTxs.sort((a, b) => b.computeUnits - a.computeUnits);
    }

    return filteredTxs;
  }, [transactions, filter, sortMode]);

  if (filteredTransactions.length === 0) {
    const errorMessage =
      filter === ALL_TRANSACTIONS
        ? "This block has no transactions"
        : "No transactions found with this filter";
    return <ErrorCard text={errorMessage} />;
  }

  let title: string;
  if (filteredTransactions.length === transactions.length) {
    title = `Block Transactions (${filteredTransactions.length})`;
  } else {
    title = `Block Transactions`;
  }

  return (
    <div className="card">
      <div className="card-header align-items-center">
        <h3 className="card-header-title">{title}</h3>
        <FilterDropdown
          filter={filter}
          toggle={() => setDropdown((show) => !show)}
          show={showDropdown}
          invokedPrograms={invokedPrograms}
          totalTransactionCount={transactions.length}
        ></FilterDropdown>
      </div>

      <div className="table-responsive mb-0">
        <table className="table table-sm table-nowrap card-table">
          <thead>
            <tr>
              <th
                className="text-muted c-pointer"
                onClick={() => {
                  query.delete("sort");
                  history.push(pickClusterParams(location, query));
                }}
              >
                #
              </th>
              <th className="text-muted">Result</th>
              <th className="text-muted">Transaction Signature</th>
              <th
                className="text-muted c-pointer"
                onClick={() => {
                  query.set("sort", "compute");
                  history.push(pickClusterParams(location, query));
                }}
              >
                Compute
              </th>
              <th className="text-muted">Invoked Programs</th>
            </tr>
          </thead>
          <tbody className="list">
            {filteredTransactions.slice(0, numDisplayed).map((tx, i) => {
              let statusText;
              let statusClass;
              let signature: React.ReactNode;
              if (tx.meta?.err || !tx.signature) {
                statusClass = "warning";
                statusText = "Failed";
              } else {
                statusClass = "success";
                statusText = "Success";
              }

              if (tx.signature) {
                signature = (
                  <Signature signature={tx.signature} link truncateChars={48} />
                );
              }

              const entries = [...tx.invocations.entries()];
              entries.sort();

              return (
                <tr key={i}>
                  <td>{tx.index + 1}</td>
                  <td>
                    <span className={`badge bg-${statusClass}-soft`}>
                      {statusText}
                    </span>
                  </td>

                  <td>{signature}</td>
                  <td className="text-end">
                    {tx.logTruncated && ">"}
                    {new Intl.NumberFormat("en-US").format(tx.computeUnits)}
                  </td>
                  <td>
                    {tx.invocations.size === 0
                      ? "NA"
                      : entries.map(([programId, count], i) => {
                          return (
                            <div key={i} className="d-flex align-items-center">
                              <Address pubkey={new PublicKey(programId)} link />
                              <span className="ms-2 text-muted">{`(${count})`}</span>
                            </div>
                          );
                        })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {block.transactions.length > numDisplayed && (
        <div className="card-footer">
          <button
            className="btn btn-primary w-100"
            onClick={() =>
              setNumDisplayed((displayed) => displayed + PAGE_SIZE)
            }
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
}

type FilterProps = {
  filter: string;
  toggle: () => void;
  show: boolean;
  invokedPrograms: Map<string, number>;
  totalTransactionCount: number;
};

const ALL_TRANSACTIONS = "all";
const HIDE_VOTES = "";

type FilterOption = {
  name: string;
  programId: string;
  transactionCount: number;
};

const FilterDropdown = ({
  filter,
  toggle,
  show,
  invokedPrograms,
  totalTransactionCount,
}: FilterProps) => {
  const { cluster } = useCluster();
  const buildLocation = (location: Location, filter: string) => {
    const params = new URLSearchParams(location.search);
    if (filter === HIDE_VOTES) {
      params.delete("filter");
    } else {
      params.set("filter", filter);
    }
    return {
      ...location,
      search: params.toString(),
    };
  };

  let defaultFilterOption: FilterOption = {
    name: "All Except Votes",
    programId: HIDE_VOTES,
    transactionCount:
      totalTransactionCount -
      (invokedPrograms.get(VOTE_PROGRAM_ID.toBase58()) || 0),
  };

  let allTransactionsOption: FilterOption = {
    name: "All Transactions",
    programId: ALL_TRANSACTIONS,
    transactionCount: totalTransactionCount,
  };

  let currentFilterOption =
    filter !== ALL_TRANSACTIONS ? defaultFilterOption : allTransactionsOption;

  const filterOptions: FilterOption[] = [
    defaultFilterOption,
    allTransactionsOption,
  ];
  const placeholderRegistry = new Map();

  [...invokedPrograms.entries()].forEach(([programId, transactionCount]) => {
    const name = displayAddress(programId, cluster, placeholderRegistry);
    if (filter === programId) {
      currentFilterOption = {
        programId,
        name: `${name} Transactions (${transactionCount})`,
        transactionCount,
      };
    }
    filterOptions.push({ name, programId, transactionCount });
  });

  filterOptions.sort((a, b) => {
    if (a.transactionCount !== b.transactionCount) {
      return b.transactionCount - a.transactionCount;
    } else {
      return b.name > a.name ? -1 : 1;
    }
  });

  return (
    <div className="dropdown me-2">
      <button
        className="btn btn-white btn-sm dropdown-toggle"
        type="button"
        onClick={toggle}
      >
        {currentFilterOption.name}
      </button>
      <div
        className={`token-filter dropdown-menu-end dropdown-menu${
          show ? " show" : ""
        }`}
      >
        {filterOptions.map(({ name, programId, transactionCount }) => {
          return (
            <Link
              key={programId}
              to={(location: Location) => buildLocation(location, programId)}
              className={`dropdown-item${
                programId === filter ? " active" : ""
              }`}
              onClick={toggle}
            >
              {`${name} (${transactionCount})`}
            </Link>
          );
        })}
      </div>
    </div>
  );
};
