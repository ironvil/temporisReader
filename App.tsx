import React from 'react';
import {SafeAreaView, useColorScheme} from 'react-native';

import {Colors} from 'react-native/Libraries/NewAppScreen';
import ReadingScreen from './src/reading-screen/ReadingScreen';
import styled from 'styled-components/native';

const AppBackground = styled.SafeAreaView`
  background-color: ${Colors.darker};
  width: 100%;
  height: 100%;
`;

const App = () => {
  return (
    <AppBackground>
      <ReadingScreen />
    </AppBackground>
  );
};

export default App;
