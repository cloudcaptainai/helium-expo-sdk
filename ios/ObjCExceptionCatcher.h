#import <Foundation/Foundation.h>

@interface ObjCExceptionCatcher : NSObject

// Executes block and catches any NSException. Returns YES if successful, NO if exception caught.
+ (BOOL)execute:(void(NS_NOESCAPE ^)(void))block;

@end
