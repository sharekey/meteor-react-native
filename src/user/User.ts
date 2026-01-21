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
    const user_id =
      (this._reactiveDict.get('_userIdSaved') as string | null) ??
      User._userIdSaved;

    if (typeof user_id === 'string' && user_id.length > 0) {
      return user_id;
    }
    return null;
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
    const finish = (err?: any) => {
      if (err) {
        User._endLoggingOut();
        if (typeof callback === 'function') callback(err);
        return;
      }
      User.handleLogout();
      if (typeof callback === 'function') callback();
    };

    User._isTokenLogin = false;
    User._startLoggingOut();

    try {
      Meteor.call('logout', (err: any) => {
        finish(err ?? undefined);
      });
    } catch (error) {
      finish(error);
    }
  },

  handleLogout(): void {
    Data._options.KeyStorage.removeItem(TOKEN_KEY);
    Data._options.KeyStorage.removeItem(TOKEN_EXPIRATION_KEY);
    Data._options.KeyStorage.removeItem(USER_ID_KEY);
    (Data as any)._tokenIdSaved = null;
    Meteor._reactiveDict.set('isLoggedIn', false);
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
        Meteor.logger(
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
      Meteor._reactiveDict.set('isLoggedIn', true);
      User._endLoggingIn();
      this._isTokenLogin = false;
      Data.notify('onLogin');
    } else {
      Meteor.isVerbose &&
        Meteor.logger('User._handleLoginCallback::: error:', err);
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
    value: string | null | undefined,
    callback?: (err?: any, result?: any) => void
  ): Promise<void> {
    const token =
      typeof value === 'string' && value.trim().length > 0 ? value : null;

    return new Promise((resolve) => {
      const safeStringify = (payload: any) => {
        try {
          return JSON.stringify(payload);
        } catch (e) {
          return String(payload);
        }
      };

      if (!token) {
        Meteor.isVerbose &&
          Meteor.logger(
            'User._loginWithToken::: token is missing, skipping resume.'
          );
        Meteor._reactiveDict.set('isLoggedIn', false);
        (Data as any)._tokenIdSaved = null;
        this._isTokenLogin = false;
        if (this._isCallingLogin) {
          this._isCallingLogin = false;
        }
        User._endLoggingIn();
        resolve();
        return;
      }

      if (this._isCallingLogin) {
        resolve();
        return;
      }

      (Data as any)._tokenIdSaved = token;
      this._isTokenLogin = true;
      Meteor.isVerbose &&
        Meteor.logger('User._loginWithToken::: token:', token);

      this._isCallingLogin = true;
      User._startLoggingIn();

      const respond = (err: any, result: any) => {
        if (Meteor.isVerbose) {
          Meteor.logger(
            `User._loginWithToken::: respond err=${safeStringify(
              err
            )} result=${safeStringify(result)}`
          );
        }
        this._isCallingLogin = false;
        let loginError = err;
        const missingToken =
          !result ||
          typeof (result as any).token !== 'string' ||
          !(result as any).token;

        if (!loginError && missingToken) {
          loginError = {
            error: 'not-authorized',
            reason: 'Login response missing token',
            details: { result },
          };
          Meteor.isVerbose &&
            Meteor.logger(
              `User._loginWithToken::: synthesized error for missing token ${safeStringify(
                loginError
              )}`
            );
        }

        const isRateLimited = loginError?.error == 'too-many-requests';
        const isResumeRejection =
          loginError?.error === 403 ||
          loginError?.error === 'token-expired' ||
          loginError?.error === 'not-authorized';

        if (Meteor.isVerbose && isResumeRejection) {
          Meteor.logger(
            `User._loginWithToken::: isResumeRejection reason ${loginError?.error}`
          );
        }

        if (isResumeRejection) {
          const status = Meteor.status();
          const loginErrorSummary =
            loginError && typeof loginError === 'object'
              ? {
                  error: loginError.error,
                  reason: loginError.reason,
                  message: loginError.message,
                }
              : loginError;

          Meteor.logger('User._loginWithToken::: resume rejected', {
            connected: status.connected,
            status: status.status,
            tokenPresent: !!token,
            userIdPresent: !!User._userIdSaved,
            isTokenLogin: this._isTokenLogin,
            loginError: loginErrorSummary,
          });
        }

        if (isRateLimited) {
          Meteor.isVerbose &&
            Meteor.logger(
              'User._handleLoginCallback::: too many requests retrying:',
              loginError
            );
          const time =
            (loginError as any).details?.timeToReset ||
            (loginError as any).timeToReset;
          User._isTokenLogin = false;
          Meteor._reactiveDict.set('isLoggedIn', false);
          User._endLoggingIn();
          setTimeout(() => {
            if (User._userIdSaved) return;
            this._loadInitialUser();
          }, (time || 0) + 100);
          Data.notify('onLoginFailure', loginError);
          Data.notify('change');
        } else if (isResumeRejection) {
          this._isTokenLogin = false;
          Meteor._reactiveDict.set('isLoggedIn', false);
          User.handleLogout();
          User._endLoggingIn();
          Data.notify('onLoginFailure', loginError);
          Data.notify('change');
        } else if (loginError) {
          // Treat other errors (e.g. transient connection issues) as retryable
          this._isTokenLogin = true;
          Meteor._reactiveDict.set('isLoggedIn', false);
          User._endLoggingIn();
          Data.notify('onLoginFailure', loginError);

          const retryToken = (Data as any)._tokenIdSaved || token;
          const delay = this._timeout;
          this._timeout = Math.min(this._timeout * 2, 8000);
          setTimeout(() => {
            if (User._userIdSaved || this._isCallingLogin) return;
            this._loginWithToken(retryToken);
          }, delay);
          Data.notify('change');
        } else {
          User._handleLoginCallback(loginError, result);
        }
        callback?.(loginError, result);
        resolve();
      };

      try {
        Meteor.call('login', { resume: token }, respond);
      } catch (error) {
        respond(error, undefined);
      }
    });
  },

  getAuthToken(): string | null {
    return (Data as any)._tokenIdSaved || null;
  },

  async _syncReactiveAuthState(): Promise<string | null> {
    let token: string | null | undefined = null;
    let storedUserId: string | null | undefined = null;
    let storedExpiration: string | null | undefined = null;

    try {
      token = await Data._options.KeyStorage.getItem(TOKEN_KEY);
      storedUserId = await Data._options.KeyStorage.getItem(USER_ID_KEY);
      storedExpiration = await Data._options.KeyStorage.getItem(
        TOKEN_EXPIRATION_KEY
      );
    } catch (error: any) {
      const message = error?.message ? error.message : String(error);
      console.warn(
        `KeyStorage error while reading auth keys (${TOKEN_KEY}, ${USER_ID_KEY}, ${TOKEN_EXPIRATION_KEY}): ${message}`
      );
    }

    // Seed reactive values so Meteor.userId() and Meteor.loginTokenExpires() are available immediately
    if (storedUserId != null) {
      this._reactiveDict.set('_userIdSaved', storedUserId);
      User._userIdSaved = storedUserId;
    } else {
      this._reactiveDict.set('_userIdSaved', null);
      User._userIdSaved = null;
    }

    if (storedExpiration != null) {
      this._reactiveDict.set('_loginTokenExpires', storedExpiration);
      User._tokenExpirationSaved = storedExpiration;
    } else {
      this._reactiveDict.set('_loginTokenExpires', null);
      User._tokenExpirationSaved = null;
    }

    return token ?? null;
  },

  async _loadInitialUser(options?: { skipLogin?: boolean }): Promise<void> {
    this._timeout = 500;

    if (!options?.skipLogin) {
      User._startLoggingIn();
    }

    const token = await this._syncReactiveAuthState();

    if (options?.skipLogin) {
      return;
    }

    await User._loginWithToken(token);
  },
};

export default User;
