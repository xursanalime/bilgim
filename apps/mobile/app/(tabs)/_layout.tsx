/**
 * Bottom-tab navigation for the authenticated area.
 *
 * Tabs (per task 22.1: Dashboard / Lessons / Homework / Profile):
 *   - Dashboard  → /(tabs)            (app/(tabs)/index.tsx)
 *   - Lessons    → /(tabs)/lessons
 *   - Homework   → /(tabs)/homework
 *   - Profile    → /(tabs)/profile
 *
 * Uses simple text "icons" (emoji) so the skeleton has zero icon-library
 * dependency. Replace with @expo/vector-icons once the design system lands.
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { colors, typography } from '../../theme/colors';

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ fontSize: 18, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.creamDim,
        tabBarStyle: {
          backgroundColor: colors.inkSurface,
          borderTopColor: colors.inkLine,
        },
        headerStyle: { backgroundColor: colors.ink },
        headerTitleStyle: {
          color: colors.cream,
          fontWeight: typography.h3.fontWeight,
        },
        headerTintColor: colors.cream,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color }) => (
            <TabIcon symbol="\u{1F3E0}" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="lessons"
        options={{
          title: 'Darslar',
          tabBarLabel: 'Darslar',
          tabBarIcon: ({ color }) => (
            <TabIcon symbol="\u{1F4DA}" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="homework"
        options={{
          title: 'Vazifalar',
          tabBarLabel: 'Vazifalar',
          tabBarIcon: ({ color }) => (
            <TabIcon symbol="\u{1F4DD}" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarLabel: 'Profil',
          tabBarIcon: ({ color }) => (
            <TabIcon symbol="\u{1F464}" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
