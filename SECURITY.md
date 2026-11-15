# Security policy

The route store hands route files from this repository to every copy of the Walkflow app, and its workflows run on pull
requests from strangers. So the problems taken seriously are:

- **A route that gives away where someone lives**, or other personal data in a route file.
- **A route file that passes the store check but harms the app**: makes it crash or hang, shows text or links it should
  not, or gets past the rules of the app's route code (`src/core/store/` in
  [walkflow-app/walkflow](https://github.com/walkflow-app/walkflow)).
- **The workflows:** a pull request that makes `Route preview` (`pull_request_target`) run its code or write anything
  but the map, or that reaches the deploy key that pushes `index.json`, or `main` without a review.

## Reporting a problem

Please do not open a public issue for these. Use **Security → Report a vulnerability** on the
[repository page](https://github.com/walkflow-app/route-store/security/advisories/new): it is private and reaches the
maintainer directly. Say which route or workflow it is, what you did and what happened.

A route that shows where someone lives is taken out first and discussed after. This is a project run by one person in
their free time, so there is no promised response time beyond that.

## What is supported

`main`, which is what the app reads. A problem in the app's own route code goes to
[walkflow-app/walkflow](https://github.com/walkflow-app/walkflow/security/advisories/new).

## What is not a security problem

A wrong fact, a path that is closed or a bad translation in a route: please open a normal issue.
