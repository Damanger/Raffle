import { getDatabase } from 'firebase/database';
import { app } from './firebase-client';

export const database = getDatabase(app);
