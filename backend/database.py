"""Async MongoDB persistence for raw accessibility scan results."""
from datetime import datetime, timezone

import certifi
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import PyMongoError


class PersistenceFailure(Exception):
    """Scan results could not be written without exposing driver details."""


class MongoScanRepository:
    """Small Motor wrapper; one client is shared by every scan worker."""

    def __init__(self, uri, database, collection='scan_results', client=None):
        if not uri.startswith(('mongodb://', 'mongodb+srv://')):
            raise ValueError('MONGO_URI must be a MongoDB connection string')
        if not database or not collection:
            raise ValueError('MongoDB database and collection names must be configured')
        # certifi supplies the CA bundle so Atlas TLS works on minimal hosts too.
        self.client = client or AsyncIOMotorClient(
            uri,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            socketTimeoutMS=20000,
            appname='accesspilot',
        )
        self.collection = self.client[database][collection]

    async def save_scan(self, target_url, results, *, job_id=None):
        """Insert one raw axe-core report and return its MongoDB _id as a string."""
        document = {
            'target_url': target_url,
            'timestamp': datetime.now(timezone.utc),
            'results': results,
        }
        if job_id:
            document['job_id'] = job_id
        try:
            inserted = await self.collection.insert_one(document)
        except (PyMongoError, TypeError, ValueError):
            raise PersistenceFailure('scan_results_insert_failed') from None
        return str(inserted.inserted_id)

    def close(self):
        self.client.close()


class NullScanRepository:
    """Used only when MONGO_URI is absent (tests and local health checks)."""

    async def save_scan(self, target_url, results, *, job_id=None):
        return None

    def close(self):
        pass
