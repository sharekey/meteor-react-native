import Meteor, { type MeteorBase } from './Meteor';
import User from './user/User';
import Accounts from './user/Accounts';
import Tracker from './Tracker';

type MeteorExport = MeteorBase & typeof User;
const MeteorAugmented = Meteor as MeteorExport;

Object.assign(MeteorAugmented, User);

const { useTracker, withTracker, Mongo, ReactiveDict } = MeteorAugmented;

export { useTracker, Accounts, withTracker, Mongo, ReactiveDict, Tracker };
export { Vent } from './vent';
export type { LoginFailurePayload } from './user/User';
export default MeteorAugmented;
