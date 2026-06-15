
#!/usr/bin/env python3
"""Scientific Calculator Script"""

import math

def add(a: float, b: float) -> float:
    """Add two numbers"""
    return a + b

def subtract(a: float, b: float) -> float:
    """Subtract b from a"""
    return a - b

def multiply(a: float, b: float) -> float:
    """Multiply two numbers"""
    return a * b

def divide(a: float, b: float) -> float:
    """Divide a by b"""
    if b == 0:
        raise ZeroDivisionError("Cannot divide by zero")
    return a / b

def power(a: float, b: float) -> float:
    """Raise a to the power of b"""
    return a ** b

def sqrt(x: float) -> float:
    """Calculate square root"""
    return math.sqrt(x)

def sin(x: float) -> float:
    """Calculate sine"""
    return math.sin(x)

def cos(x: float) -> float:
    """Calculate cosine"""
    return math.cos(x)

def tan(x: float) -> float:
    """Calculate tangent"""
    return math.tan(x)

def log(x: float) -> float:
    """Calculate natural logarithm"""
    return math.log(x)

def ln(x: float) -> float:
    """Calculate natural logarithm (same as log)"""
    return math.log(x)

def exp(x: float) -> float:
    """Calculate e^x"""
    return math.exp(x)

def factorial(n: int) -> float:
    """Calculate factorial"""
    if n < 0:
        raise ValueError("Factorial not defined for negative numbers")
    if n == 0 or n == 1:
        return 1
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result

def main():
    """Main calculator function"""
    print("Scientific Calculator")
    print("=" * 40)
    
    while True:
        print("\n1. Add")
        print("2. Subtract")
        print("3. Multiply")
        print("4. Divide")
        print("5. Power")
        print("6. Square Root")
        print("7. Sine")
        print("8. Cosine")
        print("9. Tangent")
        print("10. Logarithm")
        print("11. Natural Log")
        print("12. Exponential")
        print("13. Factorial")
        print("14. Exit")
        
        choice = input("Enter choice (1-14): ").strip()
        
        if choice == '14':
            print("Goodbye!")
            break
        
        if choice == '1':
            try:
                a = float(input("Enter first number: "))
                b = float(input("Enter second number: "))
                result = add(a, b)
                print(f"{a} + {b} = {result}")
            except ValueError:
                print("Invalid input. Please enter numbers.")
        
        elif choice == '2':
            try:
                a = float(input("Enter first number: "))
                b = float(input("Enter second number: "))
                result = subtract(a, b)
                print(f"{a} - {b} = {result}")
            except ValueError:
                print("Invalid input. Please enter numbers.")
        
        elif choice == '3':
            try:
                a = float(input("Enter first number: "))
                b = float(input("Enter second number: "))
                result = multiply(a, b)
                print(f"{a} * {b} = {result}")
            except ValueError:
                print("Invalid input. Please enter numbers.")
        
        elif choice == '4':
            try:
                a = float(input("Enter first number: "))
                b = float(input("Enter second number: "))
                result = divide(a, b)
                print(f"{a} / {b} = {result}")
            except ValueError:
                print("Invalid input. Please enter numbers.")
            except ZeroDivisionError:
                print("Cannot divide by zero.")
        
        elif choice == '5':
            try:
                a = float(input("Enter base number: "))
                b = float(input("Enter exponent: "))
                result = power(a, b)
                print(f"{a} ^ {b} = {result}")
            except ValueError:
                print("Invalid input. Please enter numbers.")
        
        elif choice == '6':
            try:
                x = float(input("Enter number: "))
                result = sqrt(x)
                print(f"√{x} = {result}")
            except ValueError:
                print("Invalid input. Please enter a number.")
        
        elif choice == '7':
            try:
                x = float(input("Enter angle (degrees): "))
                result = sin(x * math.pi / 180)
                print(f"sin({x}°) = {result}")
            except ValueError:
                print("Invalid input. Please enter a number.")
        
        elif choice == '8':
            try:
                x = float(input("Enter angle (degrees): "))
                result = cos(x * math.pi / 180)
                print(f"cos({x}°) = {result}")
            except ValueError:
                print("Invalid input. Please enter a number.")
        
        elif choice == '9':
            try:
                x = float(input("Enter angle (degrees): "))
                result = tan(x * math.pi / 180)
                print(f"tan({x}°) = {result}")
            except ValueError:
                print("Invalid input. Please enter a number.")
        
        elif choice == '10':
            try:
                x = float(input("Enter number: "))
                result = log(x)
                print(f"ln({x}) = {result}")
            except ValueError:
                print("Invalid input. Please enter a positive number.")
        
        elif choice == '11':
            try:
                x = float(input("Enter number: "))
                result = ln(x)
                print(f"ln({x}) = {result}")
            except ValueError:
                print("Invalid input. Please enter a positive number.")
        
        elif choice == '12':
            try:
                x = float(input("Enter number: "))
                result = exp(x)
                print(f"e^({x}) = {result}")
            except ValueError:
                print("Invalid input. Please enter a number.")
        
        elif choice == '13':
            try:
                n = int(input("Enter number: "))
                result = factorial(n)
                print(f"{n}! = {result}")
            except ValueError:
                print("Invalid input. Please enter a non-negative integer.")
        
        else:
            print("Invalid choice. Please enter 1-14.")

if __name__ == "__main__":
    main()
