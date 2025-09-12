import { forwardRef, memo, createElement } from 'react';
import useTracker from './useTracker';

/**
 * Wraps a component/App, so it runs, once the data
 * is available and re-runs, if the data changes
 *
 * @example
 * let AppContainer = withTracker(() => {
 *   Meteor.subscribe('myThing');
 *   let myThing = MyCol.findOne();
 *
 *   return {
 *     myThing,
 *   };
 * })(App);
 *
 * export default AppContainer;
 * @param options
 * @returns {function(React.Component):React.NamedExoticComponent}
 */
export default function withTracker<TProps = any>(
  options: ((props: TProps) => Record<string, any>) | { getMeteorData: (props: TProps) => Record<string, any>; pure?: boolean }
) {
  return (Component: any) => {
    const expandedOptions =
      typeof options === 'function' ? { getMeteorData: options } : options;
    const { getMeteorData, pure = true } = expandedOptions;

    const WithTracker = (forwardRef as any)((props: TProps, ref: any) => {
      const data = useTracker(() => getMeteorData(props) || {}, [props]);
      return createElement(Component as any, { ref, ...props, ...data });
    });

    return pure ? memo(WithTracker) : WithTracker;
  };
}
