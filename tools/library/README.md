# School library expansion

These tools prepare and import learning resources for Rusununguko ZIMFEP High
School. They do not change Android policies, installed apps, or user documents.
Downloads and binary bundles stay under ignored `artifacts/`.

## Preparation

`prepare-expansion.py` consumes the reviewed publisher-download manifests in
`artifacts/school-library-expansion`. It validates PDFs, deduplicates content,
creates offline English literature PDFs, and extracts attributed robotics packs
and wiring diagrams from SparkFun's corrected v4.1a guide. Its local PDF/text
dependencies are PyMuPDF and ReportLab. It uses Windows Arial for literature.

`review-expansion.py` checks representative PDF pages, corrects classification,
excludes third-party revision compilations without verified redistribution
permission, creates `catalog.csv`, and packages the private upload. African
Storybook PDFs have a publisher debug URL before the PDF header; these are
normalised with every page and all extracted text verified unchanged.

`prepare-openstax-server.py` downloads directly from OpenStax on the school
server. Image resolution is reduced for offline use; page count and every page's
extracted-text hash must remain identical. Original publisher credits and licence
pages remain in each book. Large original PDFs are not published automatically.

## Import

On the self-hosted server, with `storage_helpers.py` beside the importer:

```sh
python3 import-expansion.py /root/primesecure-library-stage/bundle
python3 import-expansion.py /root/primesecure-library-stage/bundle --apply \
  --openstax /root/primesecure-library-stage/openstax-manifest.json
```

Default mode validates and reads catalog metadata. Apply mode:

1. Validates hashes and the total school resource budget of **1,000,000,000 bytes**.
2. Saves an owner-only catalog/access/folder backup in `/root/primesecure-backups/`.
3. Uploads immutable school-private objects and downloads each one to verify it.
4. Rechecks the budget under a database lock and publishes the batch atomically.
5. Creates the folder ancestry and writes an import report. An identical rerun
   skips existing content; it does not resurrect withdrawn resources.

The importer obtains service credentials only inside the server's Docker
environment. It never prints them or sends them to this repository. Existing
resources, apps, policies, bucket visibility and access grants are preserved.
Catalog changes use the existing library-sync triggers; no APK is required.

## Classification and rights

- Official ZIMSEC **examiner reports** are separate from actual past papers.
- **Specimen papers** and practical inserts are separately labelled.
- Current and archived **syllabuses** have a dedicated root folder. Coverage is
  limited to verified downloadable documents; this is not every ZIMSEC subject.
- **Reading library / English** separates novels and plays. Public-domain source
  text and the Project Gutenberg licence remain in the offline PDFs.
- **Reading library / Shona / Readers & stories** contains attributed CC BY
  African Storybook readers. These are not modern Shona novels or prescribed
  secondary literature.
- SparkFun material is CC BY-SA 4.0. Robotics grouping is supplementary and
  requires teacher review, compatible components and supervised low-voltage work.
- OpenStax and Siyavula material retains its book-specific licence. NC material
  is for the user's confirmed free, noncommercial school access. Foreign
  textbooks are topic supplements, not ZIMSEC-approved equivalents.
- Jitimu's personal-copy terms do not establish school rehosting permission, so
  its notes are not included. No paywalls or access controls are bypassed.

## Verification

`test-import.cjs` runs the generated import SQL in the repository's PGlite test
engine and checks idempotence, ancestor folders, preservation of an existing app,
and transaction rollback when the 1GB limit would be exceeded. Live import
verification separately checks stored object hashes and published catalog counts.
This does not prove that every page has been read or every file has downloaded
onto a physical Primebook.

Run the transaction checks from the repository root with
`node tools/library/test-import.cjs`. The reviewed staged inventory is recorded in
`catalog-2026-10.csv` and `review-2026-10.json`; these are preparation reports,
not proof of live publication. Use the server's `import-report.json` for that.
