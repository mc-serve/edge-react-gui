import React, { useMemo } from 'react'
import { StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native'
import Animated, {
  Easing,
  EasingFunction,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated'

import { cacheStyles, Theme, useTheme } from '../services/ThemeContext'

const ANIMATION_DURATION_DEFAULT = 1000
const NUMBERS = Array(10)
  .fill(0)
  .map((_, i) => i)

export interface AnimatedNumberProps {
  digitHeight: number
  numberString: string
  animationDuration?: number
  textStyle?: TextStyle
  easing?: EasingFunction
  style?: ViewStyle
}

export const AnimatedNumber = (
  props: AnimatedNumberProps
): React.ReactElement => {
  const {
    digitHeight,
    numberString,
    textStyle,
    animationDuration = ANIMATION_DURATION_DEFAULT,
    easing = Easing.inOut(Easing.quad),
    style
  } = props
  const animateToNumbersArr: string[] = Array.from(numberString, String)

  const numberStyle: StyleProp<ViewStyle> = useMemo(
    () => [style, { flexDirection: 'row' }],
    [style]
  )

  return (
    <View style={numberStyle}>
      {animateToNumbersArr.map((n, index) => {
        return (
          <AnimatedDigit
            animationDuration={animationDuration}
            key={index}
            index={index}
            easing={easing}
            textStyle={textStyle}
            digit={n}
            numberHeight={digitHeight}
          />
        )
      })}
    </View>
  )
}

function isIntegerDigit(str: string) {
  // Use parseInt with radix 10 to convert the string to an integer.
  // If it's a valid integer, the result will not be NaN.
  if (str.length !== 1)
    throw new Error('isIntegerDigit requires string length=1')
  return !isNaN(parseInt(str, 10))
}

interface AnimatedDigitProps {
  index: number
  digit: string
  animationDuration: number
  easing: EasingFunction
  textStyle?: TextStyle
  numberHeight: number
}

const AnimatedDigit = (props: AnimatedDigitProps): React.ReactElement => {
  const { animationDuration, digit, easing, textStyle, index, numberHeight } =
    props
  const animY = useSharedValue(0)
  const textStyleProp: StyleProp<ViewStyle> = useMemo(
    () => [textStyle, { height: numberHeight }],
    [numberHeight, textStyle]
  )
  const containerStyle: StyleProp<ViewStyle> = useMemo(
    () => ({ height: numberHeight, overflow: 'hidden' }),
    [numberHeight]
  )
  const styles = getStyles(useTheme())

  if (!isIntegerDigit(digit)) {
    animY.value = withTiming(0, { duration: animationDuration, easing })
  } else {
    const height = -1 * (numberHeight * Number(digit))
    animY.value = withTiming(height, { duration: animationDuration, easing })
  }

  const animStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateY: animY.value
        }
      ]
    }
  })
  if (!isIntegerDigit(digit)) {
    return (
      <Text key={index} style={textStyleProp}>
        {digit}
      </Text>
    )
  }

  return (
    <View key={index} style={containerStyle}>
      <Animated.View style={animStyle}>
        {NUMBERS.map(number => (
          <View style={styles.textContainer} key={number}>
            <Text style={textStyleProp}>{number}</Text>
          </View>
        ))}
      </Animated.View>
    </View>
  )
}
const getStyles = cacheStyles((theme: Theme) => ({
  textContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  }
}))
