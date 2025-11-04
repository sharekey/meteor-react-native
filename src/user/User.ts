import Data from '../Data';
import { hashPassword } from '../../lib/utils';
import Mongo from '../Mongo';
import Meteor from '../Meteor';
import ReactiveDict from '../ReactiveDict';
import type { Collection } from '../Collection';

type UserDoc<T> = { _id: string } & Record<string, any> & T;

const TOKEN_KEY = 'Meteor.loginToken';
const TOKEN_EXPIRATION_KEY = 'Meteor.loginTokenExpires';
const USER_ID_KEY = 'Meteor.userId';
const Users = new (Mongo as any).Collection('users') as Collection<
  UserDoc<unknown>
>;

/**
 * @namespace User
 * @type {object}
 * @summary Represents all user/Accounts related functionality,
 * that is to be available on the `Meteor` Object.
 */
const User = {
  users: Users,
  _reactiveDict: new ReactiveDict(),

  user<T>(): UserDoc<T> | null {
    const user_id = this._reactiveDict.get('_userIdSaved');
    if (!user_id) return null;
    return (Users.findOne(user_id) as UserDoc<T>) || null;
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
  _tokenExpirationSaved: null as string | null,

  /**
   * Normalize a token expiration value (number, string, Date, or {$date}) to an ISO string or null.
   */
  _normalizeTokenExpiration(exp: any): string | null {
    if (!exp) return null;
    let d: Date | null = null;
    if (exp instanceof Date) d = exp;
    else if (typeof exp === 'number') d = new Date(exp);
    else if (typeof exp === 'string') d = new Date(exp);
    else if (typeof exp === 'object' && (exp as any).$date)
      d = new Date((exp as any).$date);

    if (!d || isNaN(d.getTime())) return null;
    return d.toISOString();
  },

  loginTokenExpires(): Date | null {
    const iso =
      (this._reactiveDict.get('_loginTokenExpires') as string | null) ??
      User._tokenExpirationSaved;
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  },
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
      if (typeof callback === 'function') callback(err);
    });
  },

  handleLogout(): void {
    Data._options.KeyStorage.removeItem(TOKEN_KEY);
    Data._options.KeyStorage.removeItem(TOKEN_EXPIRATION_KEY);
    Data._options.KeyStorage.removeItem(USER_ID_KEY);
    (Data as any)._tokenIdSaved = null;
    this._reactiveDict.set('_userIdSaved', null);
    this._reactiveDict.set('_loginTokenExpires', null);

    User._userIdSaved = null;
    User._tokenExpirationSaved = null;
    User._endLoggingOut();
    Data.notify('onLogout');
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
      const normalizedExpiration =
        User._normalizeTokenExpiration(result?.tokenExpires) ?? null;

      Data._options.KeyStorage.setItem(TOKEN_KEY, result.token);
      if (result?.id !== null) {
        Data._options.KeyStorage.setItem(USER_ID_KEY, String(result.id));
      } else {
        Data._options.KeyStorage.removeItem(USER_ID_KEY);
      }
      if (normalizedExpiration) {
        Data._options.KeyStorage.setItem(
          TOKEN_EXPIRATION_KEY,
          normalizedExpiration
        );
      } else {
        Data._options.KeyStorage.removeItem(TOKEN_EXPIRATION_KEY);
      }
      (Data as any)._tokenIdSaved = result.token;
      User._tokenExpirationSaved = normalizedExpiration;
      this._reactiveDict.set('_loginTokenExpires', normalizedExpiration);
      this._reactiveDict.set('_userIdSaved', result.id);
      User._userIdSaved = result.id;
      User._endLoggingIn();
      this._isTokenLogin = false;
      Data.notify('onLogin');
    } else {
      Meteor.isVerbose &&
        console.info('User._handleLoginCallback::: error:', err);
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
          const time =
            (err as any).details?.timeToReset || (err as any).timeToReset;
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
    let storedUserId: string | null = null;
    let storedExpiration: string | null = null;
    try {
      value = await Data._options.KeyStorage.getItem(TOKEN_KEY);
      storedUserId = await Data._options.KeyStorage.getItem(USER_ID_KEY);
      storedExpiration = await Data._options.KeyStorage.getItem(
        TOKEN_EXPIRATION_KEY
      );
    } catch (error: any) {
      console.warn('KeyStorage error: ' + error.message);
    } finally {
      // Seed reactive values so Meteor.userId() and Meteor.loginTokenExpires() are available immediately
      if (storedUserId !== null) {
        this._reactiveDict.set('_userIdSaved', storedUserId);
        User._userIdSaved = storedUserId;
      } else {
        this._reactiveDict.set('_userIdSaved', null);
        User._userIdSaved = null;
      }

      if (storedExpiration !== null) {
        this._reactiveDict.set('_loginTokenExpires', storedExpiration);
        User._tokenExpirationSaved = storedExpiration;
      } else {
        this._reactiveDict.set('_loginTokenExpires', null);
        User._tokenExpirationSaved = null;
      }

      User._loginWithToken(value);
    }
  },
};

export default User;
