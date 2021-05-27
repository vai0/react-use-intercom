import * as React from 'react';

import IntercomAPI from './api';
import IntercomContext from './context';
import initialize from './initialize';
import * as logger from './logger';
import { mapIntercomPropsToRawIntercomProps } from './mappers';
import {
  IntercomContextValues,
  IntercomProps,
  IntercomProviderProps,
  RawIntercomProps,
} from './types';
import { useInterval } from './useInterval';
import { isEmptyObject, isSSR } from './utils';

export const IntercomProvider: React.FC<IntercomProviderProps> = ({
  appId,
  autoBoot = false,
  children,
  onHide,
  onShow,
  onUnreadCountChange,
  onInitialize,
  onBoot,
  shouldInitialize = !isSSR,
  apiBase,
  initializeDelay,
  externalIntercom,
  externalIntercomFallback = true,
  externalIntercomFallbackDelay = 30000,
  ...rest
}) => {
  const isBooted = React.useRef(false);

  if (!isEmptyObject(rest) && __DEV__)
    logger.log(
      'error',
      [
        'some invalid props were passed to IntercomProvider. ',
        `Please check following props: ${Object.keys(rest).join(', ')}.`,
      ].join(''),
    );

  const getIntercomSettings = React.useCallback(
    (metaData?: RawIntercomProps) => {
      const commonSettings = {
        app_id: appId,
        ...(apiBase && { api_base: apiBase }),
        ...metaData,
      };

      let settings;
      if (externalIntercom) {
        settings = {
          ...window.intercomSettings,
          ...commonSettings,
        };
      } else {
        settings = commonSettings;
      }

      return settings;
    },
    [apiBase, appId, externalIntercom],
  );

  const boot = React.useCallback(
    (props?: IntercomProps) => {
      if (!window.Intercom && !shouldInitialize) {
        logger.log(
          'warn',
          [
            'Intercom instance is not initialized because `shouldInitialize` is set to `false` in `IntercomProvider, `',
            'or because `externalIntercom` is set to `true` in `IntercomProvider`, ',
            'and the external Intercom instance has not been initialized yet. ',
            `Please call 'boot' after the external instance has been initialized or `,
            `set 'autoBoot' to true in IntercomProvider.`,
          ].join(''),
        );
        return;
      }
      if (isBooted.current) return;

      let intercomProps;
      if (props) {
        intercomProps = mapIntercomPropsToRawIntercomProps(props);
      }

      const intercomSettings = getIntercomSettings(intercomProps);

      window.intercomSettings = intercomSettings;
      IntercomAPI('boot', intercomSettings);
      isBooted.current = true;

      if (onBoot) onBoot();
    },
    [shouldInitialize, getIntercomSettings, onBoot],
  );

  const initializeAndAttachListeners = () => {
    initialize(appId, initializeDelay);
    if (onInitialize) onInitialize();

    // Only add listeners on initialization
    if (onHide) IntercomAPI('onHide', onHide);
    if (onShow) IntercomAPI('onShow', onShow);
    if (onUnreadCountChange)
      IntercomAPI('onUnreadCountChange', onUnreadCountChange);

    if (autoBoot) boot();
  };

  // Ping for the external Intercom instance to avoid race condition where this
  // component executes before the external instance has loaded
  const [ping, setPing] = React.useState(true);
  const start = React.useRef(Date.now());

  const shouldPing = ping && externalIntercom;

  useInterval(
    () => {
      if (!isSSR && shouldInitialize && externalIntercom) {
        if (typeof window.Intercom === 'function') {
          initializeAndAttachListeners();
          setPing(false);
        } else {
          if (
            externalIntercomFallback &&
            Date.now() - start.current > externalIntercomFallbackDelay
          ) {
            initializeAndAttachListeners();
            setPing(false);
          }
        }
      }
    },
    shouldPing ? null : 1000,
  );

  if (!isSSR && shouldInitialize && !externalIntercom && !window.Intercom) {
    initializeAndAttachListeners();
  }

  const ensureIntercom = React.useCallback(
    (
      functionName: string = 'A function',
      callback: (() => void) | (() => string),
    ) => {
      if (!window.Intercom && !shouldInitialize) {
        logger.log(
          'warn',
          'Intercom instance is not initialized because `shouldInitialize` is set to `false` in `IntercomProvider`',
        );
        return;
      }
      if (!isBooted.current) {
        logger.log(
          'warn',
          [
            `'${functionName}' was called but Intercom has not booted yet. `,
            `Please call 'boot' before calling '${functionName}' or `,
            `set 'autoBoot' to true in the IntercomProvider.`,
          ].join(''),
        );
        return;
      }
      return callback();
    },
    [shouldInitialize],
  );

  const shutdown = React.useCallback(() => {
    if (!isBooted.current) return;

    IntercomAPI('shutdown');
    isBooted.current = false;
  }, []);

  const hardShutdown = React.useCallback(() => {
    if (!isBooted.current) return;

    IntercomAPI('shutdown');
    delete window.Intercom;
    delete window.intercomSettings;
    isBooted.current = false;
  }, []);

  const refresh = React.useCallback(() => {
    ensureIntercom('update', () => {
      const lastRequestedAt = new Date().getTime();
      IntercomAPI('update', { last_requested_at: lastRequestedAt });
    });
  }, [ensureIntercom]);

  const update = React.useCallback(
    (props?: IntercomProps) => {
      ensureIntercom('update', () => {
        if (!props) {
          refresh();
          return;
        }
        const rawProps = mapIntercomPropsToRawIntercomProps(props);
        window.intercomSettings = { ...window.intercomSettings, ...rawProps };
        IntercomAPI('update', rawProps);
      });
    },
    [ensureIntercom, refresh],
  );

  const hide = React.useCallback(() => {
    ensureIntercom('hide', () => {
      IntercomAPI('hide');
    });
  }, [ensureIntercom]);

  const show = React.useCallback(() => {
    ensureIntercom('show', () => IntercomAPI('show'));
  }, [ensureIntercom]);

  const showMessages = React.useCallback(() => {
    ensureIntercom('showMessages', () => {
      IntercomAPI('showMessages');
    });
  }, [ensureIntercom]);

  const showNewMessages = React.useCallback(
    (message?: string) => {
      ensureIntercom('showNewMessage', () => {
        if (!message) {
          IntercomAPI('showNewMessage');
        } else {
          IntercomAPI('showNewMessage', message);
        }
      });
    },
    [ensureIntercom],
  );

  const getVisitorId = React.useCallback(() => {
    return ensureIntercom('getVisitorId', () => {
      return IntercomAPI('getVisitorId');
    }) as string;
  }, [ensureIntercom]);

  const startTour = React.useCallback(
    (tourId: number) => {
      ensureIntercom('startTour', () => {
        IntercomAPI('startTour', tourId);
      });
    },
    [ensureIntercom],
  );

  const trackEvent = React.useCallback(
    (event: string, metaData?: object) => {
      ensureIntercom('trackEvent', () => {
        if (metaData) {
          IntercomAPI('trackEvent', event, metaData);
        } else {
          IntercomAPI('trackEvent', event);
        }
      });
    },
    [ensureIntercom],
  );

  const providerValue = React.useMemo<IntercomContextValues>(() => {
    return {
      boot,
      shutdown,
      hardShutdown,
      update,
      hide,
      show,
      showMessages,
      showNewMessages,
      getVisitorId,
      startTour,
      trackEvent,
    };
  }, [
    boot,
    shutdown,
    hardShutdown,
    update,
    hide,
    show,
    showMessages,
    showNewMessages,
    getVisitorId,
    startTour,
    trackEvent,
  ]);

  const content = React.useMemo(() => children, [children]);

  return (
    <IntercomContext.Provider value={providerValue}>
      {content}
    </IntercomContext.Provider>
  );
};

// TODO: throw error if hook is used outside of the provider
export const useIntercomContext = () => React.useContext(IntercomContext);
