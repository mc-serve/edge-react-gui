#!/bin/bash

sudo apt-get update
sudo apt-get install -y openjdk-17-jdk wget unzip ninja-build libgtk-3-dev

# 安装 Android SDK（命令行工具）
mkdir -p $HOME/android-sdk
cd $HOME/android-sdk
wget https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip -O cmdline-tools.zip
unzip cmdline-tools.zip -d cmdline-tools
mv cmdline-tools/cmdline-tools cmdline-tools/latest
rm cmdline-tools.zip
export ANDROID_SDK_ROOT=$HOME/android-sdk
echo 'export ANDROID_SDK_ROOT=$HOME/android-sdk' >> ~/.bashrc
export PATH="$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator"
echo 'export PATH="$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"' >> ~/.bashrc
export ANDROID_HOME=$HOME/android-sdk
export PATH=$ANDROID_HOME/platform-tools:$PATH

sdkmanager --list

export ANDROID_SDK_ROOT=$HOME/android-sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools

yes | sdkmanager --sdk_root=$ANDROID_SDK_ROOT \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0"

export GRADLE_OPTS="-Djava.io.tmpdir=/tmp"