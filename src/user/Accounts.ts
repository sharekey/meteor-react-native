import Data from '../Data';
import call from '../Call';
import User from './User';
import { hashPassword } from '../../lib/utils';
import Meteor from '../Meteor';

/**
 * Reference implementation to Meteor-Accounts client.
 * Use this to create and manage user accounts.
 *
 * @class
 * @see https://docs.meteor.com/api/accounts
 * @see https://docs.meteor.com/api/passwords
 */
class AccountsPassword {
  _hashPassword = hashPassword;

  /**
   * Create a user and log in.
   * @param options
   * @param callback optional callback that is invoked with one optional error argument
   */
  createUser = (
    options: { username?: string; email?: string; password: string } & Record<
      string,
      any
    >,
    callback: (err?: any) => void = () => {}
  ) => {
    // Replace password with the hashed password.
    options.password = hashPassword(options.password) as any;

    User._startLoggingIn();
    call('createUser', options, (err: any, result: any) => {
      if (Meteor.isVerbose) {
        let errText: string;
        if (err instanceof Error) {
          errText = err.stack || err.message || String(err);
        } else if (typeof err === 'string') {
          errText = err;
        } else {
          try {
            errText = JSON.stringify(err);
          } catch (_stringifyError) {
            errText = String(err);
          }
        }

        let resultText: string;
        if (typeof result === 'string') {
          resultText = result;
        } else {
          try {
            resultText = JSON.stringify(result);
          } catch (_stringifyError) {
            resultText = String(result);
          }
        }

        Meteor.logger(
          `Accounts.createUser::: err: ${errText} result: ${resultText}`
        );
      }

      User._endLoggingIn();
      User._handleLoginCallback(err, result);
      callback(err);
    });
  };

  /**
   * Changes the password of the current authenticated user
   */
  changePassword = (
    oldPassword: string | null,
    newPassword: string,
    callback: (err?: any) => void = () => {}
  ) => {
    //TODO check Meteor.user() to prevent if not logged

    if (typeof newPassword !== 'string' || !newPassword) {
      // TODO make callback(new Error(...)) instead
      return callback('Password may not be empty');
    }

    call(
      'changePassword',
      oldPassword ? hashPassword(oldPassword) : null,
      hashPassword(newPassword),
      (err: any) => {
        callback(err);
      }
    );
  };

  /**
   * Sends an email to the user with a link to set a new password
   */
  forgotPassword = (
    options: { email: string } & Record<string, any>,
    callback: (err?: any) => void = () => {}
  ) => {
    if (!options.email) {
      return callback('Must pass options.email');
    }

    call('forgotPassword', options, (err: any) => {
      callback(err);
    });
  };

  /**
   * Reset the password for a user using a token received in email.
   * Logs the user in afterwards if the user doesn't have 2FA enabled.
   */
  resetPassword = (
    token: string,
    newPassword: string,
    callback: (err?: any) => void = () => {}
  ) => {
    if (!newPassword) {
      return callback('Must pass a new password');
    }

    call(
      'resetPassword',
      token,
      hashPassword(newPassword),
      (err: any, result: any) => {
        if (Meteor.isVerbose) {
          let errText: string;
          if (err instanceof Error) {
            errText = err.stack || err.message || String(err);
          } else if (typeof err === 'string') {
            errText = err;
          } else {
            try {
              errText = JSON.stringify(err);
            } catch (_stringifyError) {
              errText = String(err);
            }
          }

          let resultText: string;
          if (typeof result === 'string') {
            resultText = result;
          } else {
            try {
              resultText = JSON.stringify(result);
            } catch (_stringifyError) {
              resultText = String(result);
            }
          }

          Meteor.logger(
            `Accounts.resetPassword::: err: ${errText} result: ${resultText}`
          );
        }
        if (!err) {
          User._loginWithToken(result.token);
        }

        callback(err);
      }
    );
  };

  /**
   * Register a callback to be called after a login attempt succeeds.
   * The callback receives the event, passed from the Data layer.
   */
  onLogin = (cb: (...args: any[]) => void) => {
    if ((Data as any)._tokenIdSaved) {
      // Execute callback immediately if already logged in
      return cb();
    }
    Data.on('onLogin', cb);
  };

  /**
   * Register a callback to be called after a login attempt fails.
   */
  onLoginFailure = (cb: (...args: any[]) => void) => {
    Data.on('onLoginFailure', cb);
  };

  /**
   * Register a callback to be called after the user logs out.
   */
  onLogout = (cb: (...args: any[]) => void) => {
    Data.on('onLogout', cb);
  };

  /**
   * Verify if the logged user has 2FA enabled
   */
  has2faEnabled = (
    callback: (err?: any, enabled?: boolean) => void = () => {}
  ) => {
    call('has2faEnabled', callback);
  };
}

export default new AccountsPassword();
