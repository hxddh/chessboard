//! The app database's schema (ADR 0003): the SDK's RelationalStore applies
//! these, forward only, in one transaction before the app starts
//! (runner.zig runWithOptions → RelationalStore.openMigrated), and records
//! the version in PRAGMA user_version. A file written by a newer build is
//! never opened by an older one (`version_unknown`).
//!
//! Every table is the same shape: `k` an order-preserving encoding of the
//! row's key (src/app/services/db-native.js `encodeKey`, which sorts as
//! IndexedDB's keys do: numbers < strings < arrays), `v` the row as JSON.
//! The table names are db.js TABLES; scripts/app/db-native.test.mjs holds
//! the two lists equal and runs the db contract against this SQL.
//!
//! Wired in by build.zig as the runner's `relational_migrations` module;
//! only a manifest that declares the `sqlite` capability opens the database
//! (app.zon .capabilities). A new version is a new entry at the end;
//! entries already shipped are never edited.

const relational = @import("native_sdk").relational_store;

pub const migrations = [_]relational.Migration{
    .{
        .version = 1,
        .name = "schema v1: the event log and its projections",
        .sql =
        \\CREATE TABLE events (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE games (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE moves (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE analysis (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE skills (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE cards (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE repertoire (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE library (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        \\CREATE TABLE settings (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID;
        ,
    },
};
