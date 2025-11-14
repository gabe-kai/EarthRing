-- EarthRing Database Schema
-- PostgreSQL with PostGIS extension
--
-- NOTE: This file is for reference only. 
-- Use migrations in database/migrations/ for actual database setup.
-- See database/migrations/README.md for migration instructions.

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- All tables are created via migrations in database/migrations/
-- Run migrations using: migrate -path database/migrations -database $DATABASE_URL up

