import 'package:flutter/material.dart';

void main() {
  runApp(const EvoIptvApp());
}

class EvoIptvApp extends StatelessWidget {
  const EvoIptvApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EVOTV',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2856D8)),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.live_tv_rounded, size: 72),
              SizedBox(height: 16),
              Text(
                'EVOTV',
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('Base do aplicativo iOS configurada.'),
            ],
          ),
        ),
      ),
    );
  }
}
