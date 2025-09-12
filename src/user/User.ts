import Data from '../Data';
import { hashPassword } from '../../lib/utils';
import Mongo from '../Mongo';
import Meteor from '../Meteor';
import ReactiveDict from '../ReactiveDict';
import type { Collection } from '../Collection';

type UserDoc = { _id: string } & Record<string, any>;

const TOKEN_KEY = 'Meteor.loginToken';
const Users = new (Mongo as any).Collection('users') as Collection<UserDoc>;

/**
 * @namespace User
 * @type {object}
 * @summary Represents all user/Accounts related functionality,
 * that is to be available on the `Meteor` Object.
 */
const User = {
  users: Users,
  _reactiveDict: new ReactiveDict(),

  user(): UserDoc | null {
    const user_id = this._reactiveDict.get('_userIdSaved');
    if (!user_id) return null;
    return Users.findOne(user_id) || null;
  },

  userId(): string | null {
    const user_id = this._reactiveDict.get('_userIdSaved');
    if (!user_id) return null;
    const user = Users.findOne(user_id);
    return user?._id ?? null;
  },

  _isLoggingIn: true,
  _isLoggingOut: false,
  _userIdSaved: null as string | null,
  _timeout: 50,
  _isTokenLogin: false,
  _isCallingLogin: false,

  loggingIn(): boolean {
    return !!this._reactiveDict.get('_loggingIn');
  },

  loggingOut(): boolean {
    return !!User._isLoggingOut;
  },

  logout(callback?: (err?: any) => void): void {
    this._isTokenLogin = false;
    User._startLoggingOut();
    Meteor.call('logout', (err: any) => {
      User.handleLogout();
      Meteor.connect();
      if (typeof callback === 'function') callback(err);
    });
  },

  handleLogout(): void {
    Data._options.KeyStorage.removeItem(TOKEN_KEY);
    (Data as any)._tokenIdSaved = null;
    this._reactiveDict.set('_userIdSaved', null);

    User._userIdSaved = null;
    User._endLoggingOut();
  },

  loginWithPassword(
    selector: string | Record<string, any>,
    password: string,
    callback?: (err?: any) => void
  ): void {
    this._isTokenLogin = false;
    let sel: Record<string, any>;
    if (typeof selector === 'string') {
      if (selector.indexOf('@') === -1) sel = { username: selector };
      else sel = { email: selector };
    } else sel = selector;

    User._startLoggingIn();
    Meteor.call(
      'login',
      {
        user: sel,
        password: hashPassword(password),
      },
      (err: any, result: any) => {
        User._handleLoginCallback(err, result);
        if (typeof callback === 'function') callback(err);
      }
    );
  },

  loginWithPasswordAnd2faCode(
    selector: string | Record<string, any>,
    password: string,
    code: string | number,
    callback?: (err?: any) => void
  ): void {
    this._isTokenLogin = false;
    let sel: Record<string, any>;
    if (typeof selector === 'string') {
      if (selector.indexOf('@') === -1) sel = { username: selector };
      else sel = { email: selector };
    } else sel = selector;

    User._startLoggingIn();
    Meteor.call(
      'login',
      {
        user: sel,
        password: hashPassword(password),
        code,
      },
      (err: any, result: any) => {
        User._handleLoginCallback(err, result);
        if (typeof callback === 'function') callback(err);
      }
    );
  },

  logoutOtherClients(callback: (err?: any) => void = () => {}): void {
    Meteor.call('getNewToken', (err: any, res: any) => {
      if (err) return callback(err);

      User._handleLoginCallback(err, res);

      Meteor.call('removeOtherTokens', (err2: any) => {
        callback(err2);
      });
    });
  },

  _login(user: any, callback?: (err?: any) => void): void {
    User._startLoggingIn();
    Meteor.call('login', user, (err: any, result: any) => {
      User._handleLoginCallback(err, result);
      if (typeof callback === 'function') callback(err);
    });
  },

  _startLoggingIn(): void {
    this._reactiveDict.set('_loggingIn', true);
    Data.notify('loggingIn');
  },

  _startLoggingOut(): void {
    User._isLoggingOut = true;
    Data.notify('loggingOut');
  },

  _endLoggingIn(): void {
    this._reactiveDict.set('_loggingIn', false);
    Data.notify('loggingIn');
  },

  _endLoggingOut(): void {
    User._isLoggingOut = false;
    Data.notify('loggingOut');
  },

  _handleLoginCallback(err: any, result: any): void {
    if (!err) {
      if (Meteor.isVerbose) {
        console.info(
          'User._handleLoginCallback::: token:',
          result?.token,
          'id:',
          result?.id
        );
      }
      Data._options.KeyStorage.setItem(TOKEN_KEY, result.token);
      (Data as any)._tokenIdSaved = result.token;
      this._reactiveDict.set('_userIdSaved', result.id);
      User._userIdSaved = result.id;
      User._endLoggingIn();
      this._isTokenLogin = false;
      Data.notify('onLogin');
    } else {
      Meteor.isVerbose && console.info('User._handleLoginCallback::: error:', err);
      if (this._isTokenLogin) {
        setTimeout(() => {
          if (User._userIdSaved) return;
          this._timeout *= 2;
          if ((Meteor as any).user()) return;
          User._loginWithToken(User._userIdSaved);
        }, this._timeout);
      }
      // Signify we aren't logging in any more after a few seconds
      if (this._timeout > 2000) {
        User._endLoggingIn();
      }
      User._endLoggingIn();
      // we delegate the error to enable better logging
      Data.notify('onLoginFailure', err);
    }
    Data.notify('change');
  },

  _loginWithToken(
    value: string | null,
    callback?: (err?: any, result?: any) => void
  ): void {
    if (!value) {
      Meteor.isVerbose &&
        console.info(
          'User._loginWithToken::: parameter value is null, will not save as token.'
        );
    } else {
      (Data as any)._tokenIdSaved = value;
    }

    if (value !== null) {
      this._isTokenLogin = true;
      Meteor.isVerbose && console.info('User._loginWithToken::: token:', value);
      if (this._isCallingLogin) {
        return;
      }
      this._isCallingLogin = true;
      User._startLoggingIn();
      Meteor.call('login', { resume: value }, (err: any, result: any) => {
        this._isCallingLogin = false;
        if (err?.error == 'too-many-requests') {
          Meteor.isVerbose &&
            console.info(
              'User._handleLoginCallback::: too many requests retrying:',
              err
            );
          const time = (err as any).details?.timeToReset || (err as any).timeToReset;
          setTimeout(() => {
            if (User._userIdSaved) return;
            this._loadInitialUser();
          }, (time || 0) + 100);
        } else if (err?.error === 403) {
          User.logout();
        } else {
          User._handleLoginCallback(err, result);
        }
        callback?.(err, result);
      });
    } else {
      Meteor.isVerbose && console.info('User._loginWithToken::: token is null');
      User._endLoggingIn();
    }
  },

  getAuthToken(): string | null {
    return (Data as any)._tokenIdSaved || null;
  },

  async _loadInitialUser(): Promise<void> {
    this._timeout = 500;

    User._startLoggingIn();
    let value: string | null = null;
    try {
      value = await Data._options.KeyStorage.getItem(TOKEN_KEY);
    } catch (error: any) {
      console.warn('KeyStorage error: ' + error.message);
    } finally {
      User._loginWithToken(value);
    }
  },
};

export default User;
