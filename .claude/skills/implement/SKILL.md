---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.

Close out against each ticket. Account for every checkbox and acceptance criterion in it, older sections further down included: each is either done, with its evidence (a test, a file, a confirmation from K), or remaining. Put that list in your final report. Done when no box is unaccounted for.

When you open a PR, its first line is `Closes #N` when nothing remains, otherwise `Part of #N` followed by the remaining items. Then tick the boxes the PR covers on the issue, noting the PR number.
